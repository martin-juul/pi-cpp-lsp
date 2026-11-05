/**
 * The words and the cache location that differ between harnesses. One process serves one harness,
 * so the harness sets these once at startup, before it builds any session or tool; the defaults are
 * pi-cpp-lsp's own.
 */
export interface HarnessWording {
  /** Starts the one-time notices and the preset command's messages. */
  notePrefix: string;
  /** The command the user switches configure presets with. */
  presetCommand: string;
  /** The project log's name: its file is `<logName>.log`, and results that point at it say "the <logName> log". */
  logName: string;
  /** The directory under the user's cache home that holds every project's managed builds, index, state and log. */
  cacheName: string;
}

const PI: HarnessWording = {
  notePrefix: "pi-cpp-lsp:",
  presetCommand: "/cpp-preset",
  logName: "pi-cpp-lsp",
  cacheName: "pi-cpp-lsp",
};

/** The current harness's wording; read it at the moment the text is made, never copy it at import. */
export const harness: Readonly<HarnessWording> = { ...PI };

/** Sets the harness's wording; the fields left out keep pi's. */
export function configureHarness(wording: Partial<HarnessWording>): void {
  Object.assign(harness, PI, wording);
}
