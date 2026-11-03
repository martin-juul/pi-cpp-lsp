import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BRIEFING_BUDGET, describeFinding, describeResolved, configureErrorExcerpt, displayPath, renderBriefing, type ProjectStatus,
} from "./briefing.ts";
import {
  ConfigureManager, isSupportedCmake, PRESET_FILES, probeCmake, resolvePreset, type CmakeVersion, type ConfigureResult, type Exec,
} from "./configure.ts";
import { FindingsLedger, findingKey, scanDrift, type DriftFinding, type DriftReport, type ReferencedSource, type UnregisteredFinding } from "./drift.ts";
import { effectiveStandard, formatStandard, isInSkippedDir, isWithin, loadProjectModel, ownersOf, type ProjectModel } from "./model.ts";
import { findSourceRoot, projectCacheDir } from "./root.ts";

export type { ProjectStatus } from "./briefing.ts";

/** How long a report point waits for a configure, the same bound as the first-run wait (KTD5, KTD13). */
export const REPORT_WAIT_MS = 20_000;
export const RECONFIGURING_NOTE = "reconfiguring; drift results follow";

/** Custom message types the extension returns from before_agent_start. */
export const BRIEFING_MESSAGE = "cpp-project-briefing";
export const LOADING_MESSAGE = "cpp-project-loading";
export const UPDATE_MESSAGE = "cpp-project-update";

const NOTE_PREFIX = "[cpp-lsp]";

/** Why an untrusted CMake project gets no project support, and how to change that (pi's project trust). */
const UNTRUSTED_REASON = "pi does not trust this project, and configuring it would run the project's CMake code";
const TRUST_STEPS = "trust the project with /trust and restart pi, or start pi with --approve";

export interface ProjectServiceOptions {
  /** The session's working directory. */
  cwd: string;
  /** Pass pi.exec. */
  exec: Exec;
  /** Tells the user once why a CMake project gets no project support (KTD18). */
  notify?: (message: string, level: "info" | "warning" | "error") => void;
  /** Report-point wait bound; defaults to REPORT_WAIT_MS. */
  waitMs?: number;
  /**
   * Whether pi trusts the project (pass ctx.isProjectTrusted() at session start). Configuring runs
   * the project's CMake code, so an untrusted CMake project gets no project support and runs no
   * cmake, git or ctest. Defaults to true.
   */
  trusted?: boolean;
}

export interface ModelChange {
  model: ProjectModel;
  /** The model this one replaces, if any. */
  previous?: ProjectModel;
  /** `compile_commands.json` in the model's build directory. */
  compileDatabase: string;
  /** The compile database differs from the one seen with the previous model (or there was none). */
  compileDatabaseChanged: boolean;
}

export interface FileOwner {
  /** Project targets that build the file. */
  targets: string[];
  /** The most restrictive standard among them (KTD7, AE8); undefined is compiler default. */
  standard?: string;
  /** "C++14", or "compiler default". */
  standardText: string;
}

export interface PresetChoice {
  /** Configure presets visible on this host, in CMake's order. */
  available: string[];
  /** The preset the last configure used, or the one the next configure will use before any finished. */
  active?: string;
  /** The preset picked when nothing valid is remembered. */
  defaultPreset?: string;
  /** Why presets are ignored or unusable, e.g. CMake older than 3.19. */
  notes: string[];
}

export interface RunMessage {
  customType: string;
  content: string;
  display: boolean;
}

/** Resolves true when `promise` settles before `deadline`, false otherwise. */
async function settlesBy(promise: Promise<unknown>, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), remaining); });
  try {
    return await Promise.race([promise.then(() => true, () => true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function mtime(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The project side of one pi session: root discovery, managed configure, the last good model
 * (KTD22), staleness at report points (KTD4), drift deltas through the findings ledger, and the
 * briefing (KTD5).
 */
export class ProjectService {
  /** CMake source root; undefined in a non-CMake directory. */
  readonly root?: string;
  private readonly exec: Exec;
  private readonly waitMs: number;
  private readonly controller = new AbortController();
  private readonly ledger = new FindingsLedger();
  private readonly listeners = new Set<(change: ModelChange) => void>();
  private readonly initialized: Promise<void>;
  private manager?: ConfigureManager;
  private cmake?: CmakeVersion;
  private nonCmake: boolean;
  private nonCmakeReason?: string;
  private nonCmakeHint?: string;

  private currentModel?: ProjectModel;
  private result?: ConfigureResult;
  private modelError?: string;
  private compileDatabaseStamp?: string;
  /** Completion of the latest trigger, including reading its replies. */
  private job?: Promise<void>;
  private readonly jobs = new WeakMap<Promise<ConfigureResult>, Promise<void>>();
  private triggeredAt = 0;

  // What pi has been told.
  private reportedResult?: ConfigureResult;
  private reportedModel?: ProjectModel;
  private reportedSkipped?: string;
  private referenced: ReferencedSource[] = [];
  private skipped?: string;
  private scanSequence = 0;
  private appliedSequence = 0;
  private ledgerStarted = false;
  /** Likely-glob files whose confirming reconfigure has not finished (KTD8). */
  private readonly globPending = new Set<string>();
  /** Likely-glob files a reconfigure did not register. */
  private readonly globRechecked = new Set<string>();

  // KTD5 run state.
  private briefingDue = true;
  private loadingSent = false;

  constructor(options: ProjectServiceOptions) {
    this.exec = options.exec;
    this.waitMs = options.waitMs ?? REPORT_WAIT_MS;
    this.root = findSourceRoot(options.cwd);
    this.nonCmake = this.root === undefined;
    if (this.root !== undefined && options.trusted === false) {
      this.nonCmake = true;
      this.nonCmakeReason = UNTRUSTED_REASON;
      this.nonCmakeHint = `To enable it, ${TRUST_STEPS}.`;
      options.notify?.(`pi-cpp-lsp: ${this.root} is a CMake project, but ${UNTRUSTED_REASON}. Project briefing and drift detection are off for this session; to enable them, ${TRUST_STEPS}.`, "warning");
    }
    this.initialized = this.root === undefined || this.nonCmake ? Promise.resolve() : this.initialize(this.root, options.notify);
  }

  private async initialize(root: string, notify: ProjectServiceOptions["notify"]): Promise<void> {
    const cmake = await probeCmake(this.exec, this.controller.signal);
    if (this.controller.signal.aborted) return;
    if (!cmake || !isSupportedCmake(cmake)) {
      this.nonCmake = true;
      this.nonCmakeReason = cmake
        ? `CMake ${cmake.text} is older than 3.14, which the project model needs`
        : "cmake was not found on PATH";
      notify?.(`pi-cpp-lsp: ${root} is a CMake project, but ${this.nonCmakeReason}. Project briefing and drift detection are off for this session; install CMake 3.14 or newer to enable them.`, "warning");
      return;
    }
    this.cmake = cmake;
    this.manager = new ConfigureManager({ root, exec: this.exec, signal: this.controller.signal, cmake });
    void this.reconfigure();
  }

  // -------------------------------------------------------------------------
  // State

  get status(): ProjectStatus {
    if (this.nonCmake) return "non-cmake";
    if (this.job || !this.result) return "configuring";
    return this.result.status === "succeeded" && !this.modelError ? "ready" : "failed";
  }

  /** Whether this session gets project support: a CMake root was found and cmake is usable (once the probe finished, see ready()). */
  get isCmake(): boolean {
    return !this.nonCmake;
  }

  /** Why a directory with a CMakeLists.txt still gets no project support. */
  get disabledReason(): string | undefined {
    return this.nonCmakeReason;
  }

  /** What the user can do to get project support, when the reason has a remedy beyond installing tools. */
  get disabledHint(): string | undefined {
    return this.nonCmakeHint;
  }

  /** The current model, or the last good one while configure is failing or running (KTD22). */
  get model(): ProjectModel | undefined {
    return this.currentModel;
  }

  /** The last finished configure. */
  get lastConfigure(): ConfigureResult | undefined {
    return this.result;
  }

  /** The managed build directory of the active preset, once known. */
  get buildDir(): string | undefined {
    return this.result?.buildDir ?? this.currentModel?.buildDir;
  }

  /** Resolves once root discovery and the cmake probe are done, or by the bound. */
  async ready(timeoutMs = this.waitMs): Promise<void> {
    await settlesBy(this.initialized, Date.now() + timeoutMs);
  }

  /** Called after each successful model load; returns an unsubscribe function. */
  onModelChange(listener: (change: ModelChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The targets that build `path` and the standard it must stay valid for; undefined without a model or owner. */
  ownerOf(path: string): FileOwner | undefined {
    const model = this.currentModel;
    if (!model) return undefined;
    const targets = ownersOf(model, path).filter(target => target.isProjectTarget).map(target => target.name);
    if (targets.length === 0) return undefined;
    const standard = effectiveStandard(model, path);
    return standard === undefined ? { targets, standardText: formatStandard(undefined) } : { targets, standard, standardText: formatStandard(standard) };
  }

  /** Force a reconfigure (or join the queued one) and resolve once its model is read; a no-op without project support. */
  async reconfigureNow(): Promise<void> {
    await this.initialized;
    await this.reconfigure();
  }

  /** The configure presets this project offers and the active one; undefined without project support. */
  async presets(): Promise<PresetChoice | undefined> {
    await this.initialized;
    if (!this.root || !this.cmake || this.controller.signal.aborted) return undefined;
    const resolution = await resolvePreset(this.root, this.exec, this.cmake, this.controller.signal);
    return {
      available: resolution.available,
      active: this.result ? this.result.preset : resolution.preset,
      defaultPreset: resolution.defaultPreset,
      notes: resolution.notes,
    };
  }

  /** Abort a running configure and stop reporting (KTD20). */
  dispose(): void {
    this.controller.abort();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Configure

  private reconfigure(): Promise<void> {
    if (!this.manager || this.controller.signal.aborted) return Promise.resolve();
    this.triggeredAt = Date.now();
    const run = this.manager.trigger();
    let job = this.jobs.get(run);
    if (!job) {
      job = run.then(result => this.absorb(result)).catch(() => {});
      this.jobs.set(run, job);
    }
    const current = job;
    this.job = current;
    void current.then(() => { if (this.job === current) this.job = undefined; });
    return current;
  }

  private async absorb(result: ConfigureResult): Promise<void> {
    if (result.status === "cancelled" || this.controller.signal.aborted) return;
    if (this.result && result.startedAt < this.result.startedAt) return;
    let model: ProjectModel | undefined;
    let modelError: string | undefined;
    // A failed configure leaves CMake's last good index in place; load it when nothing is loaded yet.
    const index = result.status === "succeeded" ? result.reply.lastGood : this.currentModel ? undefined : result.reply.lastGood;
    if (index) {
      try {
        model = await loadProjectModel({ indexFile: index, exec: this.exec, signal: this.controller.signal });
      } catch (error) {
        if (result.status === "succeeded") modelError = error instanceof Error ? error.message : String(error);
      }
    } else if (result.status === "succeeded") {
      modelError = "CMake wrote no File API reply index.";
    }
    if (this.controller.signal.aborted || (this.result && result.startedAt < this.result.startedAt)) return;
    this.result = result;
    this.modelError = modelError;
    if (model) this.replaceModel(model);
  }

  private replaceModel(model: ProjectModel): void {
    const previous = this.currentModel;
    this.currentModel = model;
    const compileDatabase = join(model.buildDir, "compile_commands.json");
    const stamp = `${compileDatabase}\0${mtime(compileDatabase) ?? "absent"}`;
    const compileDatabaseChanged = stamp !== this.compileDatabaseStamp;
    this.compileDatabaseStamp = stamp;
    for (const listener of this.listeners) {
      try {
        listener({ model, previous, compileDatabase, compileDatabaseChanged });
      } catch { /* a listener's failure must not break the session */ }
    }
  }

  // -------------------------------------------------------------------------
  // Staleness (KTD4)

  /** Every CMakeLists.txt, *.cmake and preset file under the root, for when no good model exists (KTD22). */
  private allCmakeFiles(root: string): string[] {
    const files: string[] = [];
    let cache: string | undefined;
    try { cache = projectCacheDir(root); } catch { /* the root vanished */ }
    const pending = [root];
    while (pending.length > 0) {
      const dir = pending.pop()!;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!(cache && isWithin(cache, path)) && !isInSkippedDir(root, path)) pending.push(path);
        } else if (entry.name === "CMakeLists.txt" || entry.name.endsWith(".cmake") || PRESET_FILES.includes(entry.name)) {
          files.push(path);
        }
      }
    }
    return files;
  }

  /**
   * Whether a CMake input or preset file changed since the last configure started. A deleted input
   * counts through its directory's modification time.
   */
  isStale(): boolean {
    const root = this.root;
    if (!root || !this.manager) return false;
    // A pending trigger covers changes before it; once settled, the configure that produced the
    // result is the baseline, which for one reused from another session started before the trigger.
    const baseline = this.job ? Math.max(this.triggeredAt, this.result?.startedAt ?? 0) : this.result?.startedAt ?? this.triggeredAt;
    const inputs = this.currentModel
      ? [...this.currentModel.cmakeInputs, ...PRESET_FILES.map(name => join(root, name))]
      : this.allCmakeFiles(root);
    for (const input of inputs) {
      let time = mtime(input);
      if (time === undefined && this.currentModel?.cmakeInputs.includes(input)) {
        for (let dir = dirname(input); time === undefined && isWithin(root, dir); dir = dirname(dir)) time = mtime(dir);
      }
      // A write in the same millisecond as the trigger precedes the configure reading it.
      if (time !== undefined && Math.floor(time) > baseline) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Report points

  /**
   * Run one report point (KTD4, KTD13 step 2): reconfigure when CMake inputs changed, wait up to the
   * bound, scan drift, and return the text to append to the tool result, or undefined when nothing
   * is new. Call it for every written or edited file, including CMakeLists.txt, and after bash.
   */
  async reportPoint(): Promise<string | undefined> {
    if (!this.root) return undefined;
    const deadline = Date.now() + this.waitMs;
    if (!(await settlesBy(this.initialized, deadline)) || this.nonCmake || this.controller.signal.aborted) return undefined;
    const lines = await this.refresh(deadline, false);
    return lines.length > 0 ? `${NOTE_PREFIX} ${lines.join("\n")}` : undefined;
  }

  /** The report-point lines; a briefing refresh updates the state the same way but returns none. */
  private async refresh(deadline: number, forBriefing: boolean): Promise<string[]> {
    let configuredHere = false;
    if (this.isStale()) {
      void this.reconfigure();
      configuredHere = true;
    }
    if (this.job && !(await settlesBy(this.job, deadline))) {
      return forBriefing ? [] : [RECONFIGURING_NOTE];
    }
    if (!this.result || this.controller.signal.aborted) return [];

    const lines: string[] = [];
    if (!forBriefing) lines.push(...this.configureLines(), ...this.modelChangeLines());
    this.reportedResult = this.result;
    this.reportedModel = this.currentModel;

    let report = await this.scan();
    if (!report) return lines;
    const isNew = (finding: DriftFinding) => !this.ledger.has(findingKey(finding));
    const unregisteredNow = (path: string, from: DriftReport) => from.findings.some(finding => finding.kind === "unregistered" && finding.path === path);

    // Pending glob confirmations from an earlier report point (KTD8).
    for (const path of [...this.globPending]) {
      this.globPending.delete(path);
      if (unregisteredNow(path, report.report)) this.globRechecked.add(path);
      else lines.push(this.globConfirmed(path));
    }

    // A new likely-glob file gets a reconfigure before it is reported; the first scan follows a
    // configure that already saw the tree, as does a report point that just reconfigured.
    const globNew = this.ledgerStarted && !configuredHere
      ? report.report.findings.filter(finding => finding.kind === "unregistered" && finding.likelyGlob && isNew(finding) && !this.globRechecked.has(finding.path))
      : [];
    let timedOut = false;
    if (globNew.length > 0) {
      void this.reconfigure();
      if (this.job && !(await settlesBy(this.job, deadline))) {
        timedOut = true;
        for (const finding of globNew) this.globPending.add(finding.path);
      } else {
        const rescanned = await this.scan();
        if (rescanned) report = rescanned;
        for (const finding of globNew) {
          if (unregisteredNow(finding.path, report.report)) this.globRechecked.add(finding.path);
          else lines.push(this.globConfirmed(finding.path));
        }
      }
    }
    if (report.sequence < this.appliedSequence) return lines;
    this.appliedSequence = report.sequence;

    // Held-back glob files stay out of the ledger until their reconfigure finishes.
    const held = report.report.findings.filter((finding): finding is UnregisteredFinding => finding.kind === "unregistered" && this.globPending.has(finding.path));
    const applied: DriftReport = held.length > 0 ? { ...report.report, findings: report.report.findings.filter(finding => !(held as DriftFinding[]).includes(finding)) } : report.report;
    const delta = this.ledger.update(applied);
    this.ledgerStarted = true;
    this.referenced = report.report.referenced;
    this.skipped = report.report.skipped;

    const root = this.root!;
    for (const finding of delta.new) lines.push(`New: ${describeFinding(finding, root, { globRechecked: this.globRechecked.has(finding.path) })}`);
    for (const finding of delta.resolved) lines.push(`Resolved: ${describeResolved(finding, root, this.currentModel, existsSync(finding.path))}`);
    for (const finding of held) {
      const owners = finding.candidates.map(candidate => candidate.target).join(", ");
      lines.push(`${displayPath(root, finding.path)}: ${owners} collects sources with file(GLOB), so no CMake edit should be needed; confirming after the reconfigure.`);
    }
    if (report.report.skipped !== this.reportedSkipped) {
      if (report.report.skipped) lines.push(`Note: ${report.report.skipped}.`);
      this.reportedSkipped = report.report.skipped;
    }
    if (timedOut) lines.push(RECONFIGURING_NOTE);
    return forBriefing ? [] : lines;
  }

  private async scan(): Promise<{ report: DriftReport; sequence: number } | undefined> {
    const sequence = ++this.scanSequence;
    const missingSources = this.result && this.result.status !== "succeeded" ? this.result.missingSources : [];
    try {
      const report = await scanDrift({ root: this.root!, model: this.currentModel, missingSources, exec: this.exec, signal: this.controller.signal });
      return this.controller.signal.aborted ? undefined : { report, sequence };
    } catch {
      return undefined;
    }
  }

  private globConfirmed(path: string): string {
    const owners = this.ownerOf(path)?.targets ?? [];
    const target = owners.length > 0 ? `now part of ${owners.join(", ")}` : "no longer reported";
    return `${displayPath(this.root!, path)}: no CMake edit is needed; its target collects sources with file(GLOB), and after a reconfigure it is ${target}.`;
  }

  private configureLines(): string[] {
    const result = this.result;
    if (!result || result === this.reportedResult) return [];
    const previous = this.reportedResult;
    if (result.status !== "succeeded") {
      const model = this.currentModel ? "\nDrift checks use the last good project model until configure succeeds." : "";
      return [`${configureErrorExcerpt(result)}${model}`];
    }
    if (this.modelError) return [`CMake configure succeeded, but the project model could not be read: ${this.modelError}`];
    if (previous && (previous.status !== "succeeded")) return ["CMake configure succeeded again."];
    return [];
  }

  private modelChangeLines(): string[] {
    const before = this.reportedModel;
    const after = this.currentModel;
    if (!before || !after || before === after) return [];
    const describe = (model: ProjectModel) => new Map(model.targets.filter(target => target.isProjectTarget).map(target => [target.name, target] as const));
    const old = describe(before);
    const now = describe(after);
    const changes: string[] = [];
    for (const [name, target] of now) {
      const previous = old.get(name);
      if (!previous) changes.push(`added target ${name} (${target.kind}, ${formatStandard(target.cxxStandard)})`);
      else if (previous.cxxStandard !== target.cxxStandard) changes.push(`${name} now uses ${formatStandard(target.cxxStandard)} (was ${formatStandard(previous.cxxStandard)})`);
      else if (previous.kind !== target.kind) changes.push(`${name} is now a ${target.kind}`);
    }
    for (const name of old.keys()) if (!now.has(name)) changes.push(`removed target ${name}`);
    return changes.length > 0 ? [`Project model changed: ${changes.join("; ")}.`] : [];
  }

  // -------------------------------------------------------------------------
  // Runs (KTD5)

  /** The briefing goes out again at the next run, as after compaction. */
  resendBriefing(): void {
    this.briefingDue = true;
  }

  /**
   * The message for a run's before_agent_start: the full briefing when due, a loading message when
   * the first configure has not finished within the bound, later only deltas, or nothing.
   */
  async runMessage(): Promise<RunMessage | undefined> {
    if (!this.root) return undefined;
    const deadline = Date.now() + this.waitMs;
    if (!(await settlesBy(this.initialized, deadline)) || this.nonCmake || this.controller.signal.aborted) return undefined;
    if (!this.briefingDue) {
      const lines = await this.refresh(deadline, false);
      return lines.length > 0 ? { customType: UPDATE_MESSAGE, content: `${NOTE_PREFIX} ${lines.join("\n")}`, display: true } : undefined;
    }
    await this.refresh(deadline, true);
    if (!this.result) {
      if (this.loadingSent) return undefined;
      this.loadingSent = true;
      return {
        customType: LOADING_MESSAGE, display: true,
        content: `${NOTE_PREFIX} The CMake project model for ${this.root} is still loading (configure is running). The project briefing follows with the next prompt.`,
      };
    }
    this.briefingDue = false;
    return { customType: BRIEFING_MESSAGE, content: this.briefing(), display: true };
  }

  /** The full briefing for the current state; past `budget` characters it takes the summary form. */
  briefing(budget = BRIEFING_BUDGET): string {
    return renderBriefing({
      root: this.root!, status: this.status, model: this.currentModel, result: this.result, modelError: this.modelError,
      findings: this.ledger.open, referenced: this.referenced, skipped: this.skipped,
    }, budget);
  }
}
