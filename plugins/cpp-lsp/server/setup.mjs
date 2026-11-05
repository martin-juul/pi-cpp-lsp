import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../packages/core/src/output.ts
function oneLine(text) {
  return text.replace(/\s*\n\s*/g, " ");
}
var DEFAULT_MAX_BYTES = 50 * 1024;

// ../../packages/core/src/harness.ts
var PI = {
  notePrefix: "pi-cpp-lsp:",
  presetCommand: "/cpp-preset",
  logName: "pi-cpp-lsp",
  cacheName: "pi-cpp-lsp"
};
var harness = { ...PI };
function configureHarness(wording) {
  Object.assign(harness, PI, wording);
}

// ../../packages/core/src/project/configure.ts
var CONFIGURE_TIMEOUT_MS = 3e5;
var PROBE_TIMEOUT_MS = 3e4;
var LOCK_MAX_AGE_MS = CONFIGURE_TIMEOUT_MS + 2 * PROBE_TIMEOUT_MS;
var atLeast = (v, major, minor) => v.major > major || v.major === major && v.minor >= minor;
var isSupportedCmake = (v) => atLeast(v, 3, 14);
var supportsPresets = (v) => atLeast(v, 3, 19);
async function probeCmake(exec, signal) {
  try {
    const result = await exec("cmake", ["--version"], { signal, timeout: PROBE_TIMEOUT_MS });
    const match = result.code === 0 ? result.stdout.match(/cmake version (\d+)\.(\d+)\.(\d+)\S*/) : null;
    if (!match) return void 0;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: match[0].slice("cmake version ".length) };
  } catch {
    return void 0;
  }
}

// ../../packages/core/src/toolchain.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename as basename2, extname as extname3, join as join2, resolve as resolve4 } from "node:path";

// ../../node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// ../../node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// ../../node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});

// ../../node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  CodePointCount: () => CodePointCount2,
  Counted: () => Counted,
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Some: () => Some,
  SomeAll: () => SomeAll,
  Symbols: () => Symbols,
  Values: () => Values
});

// ../../node_modules/typebox/build/guard/unicode/unicode_segment.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && IsZeroWidthJoiner(value.codePointAt(clusterEnd))) {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function GraphemeCount(value) {
  let count = 0, index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}

// ../../node_modules/typebox/build/guard/unicode/unicode.mjs
function CodePointCount(value) {
  let result = 0, index = 0, prev = 0;
  while (index < value.length) {
    const next = value.charCodeAt(index++) >> 10;
    result += +((prev << 8 | next) !== 13879);
    prev = next;
  }
  return result;
}
function IsMaxLength(value, maxLength) {
  return value.length <= maxLength || value.length <= maxLength << 1 && CodePointCount(value) <= maxLength;
}
function IsMinLength(value, minLength) {
  return value.length >= minLength << 1 || value.length >= minLength && CodePointCount(value) >= minLength;
}

// ../../node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function CodePointCount2(value) {
  return CodePointCount(value);
}
function IsMaxLength2(value, maxLength) {
  return IsMaxLength(value, maxLength);
}
function IsMinLength2(value, minLength) {
  return IsMinLength(value, minLength);
}
function Every(value, offset, callback) {
  return value.every((item, index) => index < offset || callback(item, index));
}
function EveryAll(value, offset, callback) {
  let result = true;
  value.forEach((item, index) => {
    if (index >= offset && !callback(item, index))
      result = false;
  });
  return result;
}
function Some(value, callback) {
  return value.some((value2, index) => callback(value2, index));
}
function SomeAll(value, callback) {
  let result = false;
  value.forEach((item, index) => {
    if (callback(item, index))
      result = true;
  });
  return result;
}
function Counted(value, callback) {
  return value.reduce((result, value2, index) => callback(value2, index) ? ++result : result, 0);
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// ../../node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// ../../node_modules/typebox/build/system/settings/settings.mjs
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  maxParseErrors: 1,
  maxInstantiationCount: 128,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.maxParseErrors = 1;
  settings.maxInstantiationCount = 128;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// ../../node_modules/typebox/build/system/memory/freeze.mjs
function Freeze(value) {
  return settings_exports.Get().immutableTypes ? Object.freeze(value) : value;
}

// ../../node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return Freeze({ ...left, ...right });
}

// ../../node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsSchemaObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromSchemaObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = FromValue(descriptor.value);
    if (guard_exports.IsEqual(descriptor.enumerable, true)) {
      result[key] = descriptor.value;
    } else {
      Object.defineProperty(result, key, descriptor);
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsSchemaObject(value) ? FromSchemaObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}

// ../../node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const withOptions = Merge(enumerable, options);
  const withHidden = settings_exports.Get().enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return Freeze(withHidden);
}

// ../../node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (propertyKeys.includes(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = Clone(descriptor.value);
    Object.defineProperty(result, key, descriptor);
  }
  return Freeze(result);
}

// ../../node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return Freeze(result);
}

// ../../node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}

// ../../node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// ../../node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// ../../node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// ../../node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// ../../node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}

// ../../node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// ../../node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// ../../node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// ../../node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// ../../node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// ../../node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// ../../node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// ../../node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// ../../node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// ../../node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// ../../node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// ../../node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// ../../node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// ../../node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// ../../node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}

// ../../node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types2, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types2 }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// ../../node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// ../../node_modules/typebox/build/system/hashing/hash.mjs
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
var encoder = new TextEncoder();

// ../../node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// ../../node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// ../../node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// ../../node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// ../../node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// ../../node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// ../../node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// ../../node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// ../../node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// ../../node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// ../../node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// ../../node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// ../../node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// ../../node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// ../../node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// ../../node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// ../../node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// ../../node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types2) {
  const result = guard_exports.IsEqual(types2.length, 0) ? false : FromTypesReduce(types2);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types2) {
  const result = FromTypes(types2);
  return result;
}

// ../../node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// ../../node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types2, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types2) {
  const variants = DecodeFromSpan([], types2);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types2) {
  return guard_exports.IsEqual(types2.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types2.length, 1) && IsLiteral(types2[0]) ? types2[0] : DecodeTypesAsUnion(types2)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types2 = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types2.length, 0) ? String2() : IsTemplateLiteralFinite(types2) ? DecodeTypes(types2) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// ../../node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// ../../node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// ../../node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types2, options = {}) {
  const [items, minItems, additionalItems] = [types2, types2.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// ../../node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types2) {
  const result = types2.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// ../../node_modules/typebox/build/type/engine/evaluate/composite.mjs
function CanComposite(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(left), ...guard_exports.Keys(right)]);
  const result = [...keys].reduce((result2, key) => {
    return { ...result2, [key]: CompositePropertyKey(left, right, key) };
  }, {});
  return result;
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : {};
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  const result = _Object_(properties);
  return result;
}

// ../../node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function NarrowCompareRule(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, CompareResultLeftInside) ? left : guard_exports.IsEqual(result, CompareResultRightInside) ? right : guard_exports.IsEqual(result, CompareResultEqual) ? right : Never();
}
function NarrowCompositeRule(left, right) {
  const canCompositeLeft = CanComposite(left);
  const canCompositeRight = CanComposite(right);
  return canCompositeLeft && canCompositeRight ? Composite(left, right) : canCompositeLeft && !canCompositeRight ? left : !canCompositeLeft && canCompositeRight ? right : NarrowCompareRule(left, right);
}
function Narrow(left, right) {
  return IsNever(left) ? left : IsAny(left) ? left : IsUnknown(left) ? right : IsNever(right) ? right : IsAny(right) ? right : IsUnknown(right) ? left : NarrowCompositeRule(left, right);
}

// ../../node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function ShouldEvaluate(left, right) {
  const result = IsUnion(left) || IsUnion(right);
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const shouldEvaluate = ShouldEvaluate(evaluatedLeft, evaluatedRight);
  const result = shouldEvaluate ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types2, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => DistributeType(type, right, [...result, DistributeOperation(left, type)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types2, distribution, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types2, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// ../../node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExcludeUnion(tail, right, [...result, ...ExcludeType(head, right)]), () => result);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical2 = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical2, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// ../../node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersected = EvaluateIntersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersected, excluded]);
  return result;
}
function EvaluateEnum(values, result = []) {
  return guard_exports.ShiftLeft(values, (left, right) => EvaluateEnum(right, [...result, Literal(left)]), () => EvaluateUnion(result));
}
function EvaluateIntersect(types2) {
  const distribution = Distribute(types2);
  const broadend = Broaden(distribution);
  const result = EvaluateUnion(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types2) {
  const broadend = Broaden(types2);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  const result = IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
  return result;
}
function EvaluateUnionFast(types2) {
  const result = guard_exports.IsEqual(types2.length, 1) ? types2[0] : guard_exports.IsEqual(types2.length, 0) ? Never() : Union(types2);
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types2, value) {
  const evaluatedKey = EvaluateIntersect(types2);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// ../../node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// ../../node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types2 = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types2);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// ../../node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types2, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => Flatten(right, [...result, ...FlattenType(left)]), () => result);
}

// ../../node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types2) {
  return types2.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types2, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types2), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types2, value) {
  return types2.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types2, value) {
  const properties = CreateProperties(types2, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types2, value) {
  const flattened = Flatten(types2);
  const record = TryBuildRecord(flattened, value);
  return IsSchema(record) ? record : CreateObject(flattened, value);
}

// ../../node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// ../../node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state, key, value, options) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// ../../node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// ../../node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// ../../node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// ../../node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// ../../node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// ../../node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
function DelimitedDecode(input, result = []) {
  return guard_exports.ShiftLeft(input, (left, right) => DelimitedDecode(right, [...result, left[1]]), () => result);
}
function Delimited(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], ...DelimitedDecode(input[1])] : [];
}
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementBaseMapping(input) {
  if (!guard_exports.IsArray(input) || !guard_exports.IsEqual(input.length, 3))
    return input;
  const [isReadonly, type, isOptional] = input;
  return isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return Delimited(input);
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const [moduleDeclaration, moduleDeclarationList] = [input[0], input[1]];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, PropertiesReduce(moduleDeclarationList)[0]));
}
function ScriptMapping(input) {
  return input;
}

// ../../node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// ../../node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// ../../node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// ../../node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// ../../node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// ../../node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// ../../node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// ../../node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// ../../node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// ../../node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// ../../node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(GenericParameter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(If(GenericParameter(input), ([_0, input2]) => If(GenericParameterList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(If(Type(input), ([_0, input2]) => If(GenericCallArgumentList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(PropertyDelimiter(input), ([_0, input2]) => If(Property(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(If(Property(input), ([_0, input2]) => If(PropertyList_0(input2), ([_1, input3]) => If(If(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(If(Readonly2(input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Element(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(If(Element(input), ([_0, input2]) => If(ElementList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Parameter2(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(If(Parameter2(input), ([_0, input2]) => If(ParameterList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(PropertyDelimiter(input), ([_0, input2]) => If(WithProperty(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(If(WithProperty(input), ([_0, input2]) => If(WithPropertyList_0(input2), ([_1, input3]) => If(If(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(WithValue(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(If(WithValue(input), ([_0, input2]) => If(WithElementList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Const(",", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(If(Type(input), ([_0, input2]) => If(InterfaceDeclarationHeritageList_0(input2), ([_1, input3]) => If(If(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclarationDelimiter(input), ([_0, input2]) => If(ModuleDeclaration(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList_0(input2), ([_1, input3]) => If(If(ModuleDeclarationDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// ../../node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// ../../node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types2, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types2, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types2, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types2, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types2, pattern) {
  return guard_exports.ShiftLeft(types2, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types2) {
  const encoded = EncodeTypes(types2, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types2) {
  const pattern = EncodePattern(types2);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// ../../node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types2, options) {
  const result = CanInstantiate(types2) ? memory_exports.Update(TemplateLiteralEncode(types2), {}, options) : TemplateLiteralDeferred(types2, options);
  return result;
}
function TemplateLiteralInstantiate(context, state, types2, options) {
  const instantiatedTypes = InstantiateTypes(context, state, types2);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// ../../node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types2, options = {}) {
  return Deferred("TemplateLiteral", [types2], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types2) {
  return TemplateLiteralAction(types2, {});
}
function TemplateLiteralFromString(template) {
  const types2 = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types2);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// ../../node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// ../../node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// ../../node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// ../../node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// ../../node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// ../../node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// ../../node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// ../../node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// ../../node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// ../../node_modules/typebox/build/type/extends/record.mjs
function FromObject2(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject2(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// ../../node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right) {
  const result = [];
  for (const head of rest) {
    if (!IsExtendsTrueLike(ExtendsLeft({}, head, right)))
      return void 0;
    result.push(head);
  }
  return result;
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types2) {
  return [...types2].reverse();
}
function ApplyReverse(types2, reversed) {
  return reversed ? Reverse(types2) : types2;
}
function Reversed(types2) {
  const first = types2.length > 0 ? types2[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArrayReduce(inferred, left, right) {
  for (const head of left) {
    const result = ExtendsLeft(inferred, head, right);
    if (!IsExtendsTrueLike(result))
      return result;
    inferred = result.inferred;
  }
  return ExtendsTrue(inferred);
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : ExtendsTupleToArrayReduce(inferred, left, right);
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// ../../node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// ../../node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// ../../node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// ../../node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// ../../node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}

// ../../node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types2 = PropertyValues(properties);
  return FromTypes2(stack, context, types2);
}
function FromTypes2(stack, context, types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// ../../node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// ../../node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types2 = PropertyValues(properties);
  return FromTypes3(context, types2, result);
}
function FromTypes3(context, types2, result) {
  return types2.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// ../../node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types2) {
  return types2.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// ../../node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// ../../node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// ../../node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// ../../node_modules/typebox/build/type/engine/evaluate/compare.mjs
var CompareResultEqual = 0;
var CompareResultDisjoint = 1;
var CompareResultLeftInside = 2;
var CompareResultRightInside = 3;
function Compare(left, right) {
  const extendsCheck = [Extends({}, left, right), Extends({}, right, left)];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? CompareResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultRightInside : CompareResultDisjoint;
}

// ../../node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadenFilter(type, types2, result = [], all = types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => {
    const compare = Compare(type, left);
    return guard_exports.IsEqual(compare, CompareResultLeftInside) || guard_exports.IsEqual(compare, CompareResultEqual) ? all : guard_exports.IsEqual(compare, CompareResultDisjoint) ? BroadenFilter(type, right, [...result, left], all) : BroadenFilter(type, right, result, all);
  }, () => [...result, type]);
}
function BroadenType(type, types2, result) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : (
    // terminate (always the most broad)
    IsUnknown(evaluated) ? [evaluated] : (
      // terminate (always the most broad)
      IsNever(evaluated) ? BroadenTypes(types2, result) : (
        // ignored: never is dropped
        IsObject2(evaluated) ? BroadenTypes(types2, [...result, evaluated]) : (
          // objects are always considered (too expensive to compare)
          BroadenTypes(types2, BroadenFilter(evaluated, result))
        )
      )
    )
  );
}
function BroadenTypes(types2, result = []) {
  return guard_exports.ShiftLeft(types2, (left, right) => BroadenType(left, right, result), () => result);
}
function Broaden(types2) {
  const broadened = BroadenTypes(types2);
  const flattened = Flatten(broadened);
  return flattened;
}

// ../../node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function CanonicalArgument(type) {
  return IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsEnum(type) ? EvaluateEnum(type.enum) : type;
}
function Expand(type) {
  const canonicalArgument = CanonicalArgument(type);
  return IsUnion(canonicalArgument) ? [...canonicalArgument.anyOf] : [canonicalArgument];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// ../../node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// ../../node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}

// ../../node_modules/typebox/build/type/engine/call/instantiate.mjs
var instantiationDepth = 0;
var instantiationCount = 0;
function InstantiationAssert() {
  if (guard_exports.IsLessThan(instantiationCount, settings_exports.Get().maxInstantiationCount))
    return;
  throw Error("Type instantiation is excessively deep and possibly infinite");
}
function InstantiationIncrement() {
  InstantiationAssert();
  instantiationCount++;
  instantiationDepth++;
}
function InstantiationDecrement() {
  instantiationDepth--;
  if (guard_exports.IsEqual(instantiationDepth, 0))
    instantiationCount = 0;
}
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  InstantiationIncrement();
  try {
    const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
    const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
    return InstantiateType(argumentsContext, State([], []), returnType);
  } finally {
    InstantiationDecrement();
  }
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => {
    const returnType = CallDispatch(context, state, target, parameters, expression, arguments_);
    return [...result, returnType];
  }, []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved = ResolveTarget(context, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// ../../node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// ../../node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// ../../node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// ../../node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types2) {
  const result = types2.map((type) => FromType7(mapping, type));
  return Union(result);
}

// ../../node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// ../../node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}

// ../../node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}

// ../../node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}

// ../../node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}

// ../../node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// ../../node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}

// ../../node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// ../../node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}

// ../../node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExtractUnion(tail, right, [...result, ...ExtractType(head, right)]), () => result);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical2 = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical2, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// ../../node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// ../../node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// ../../node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}

// ../../node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// ../../node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types2) {
  return types2.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// ../../node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject3(properties) {
  return properties;
}

// ../../node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types2) {
  const object = TupleToObject(Tuple(types2));
  const result = FromType8(object);
  return result;
}

// ../../node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types2, result) {
  return guard_exports.ShiftLeft(types2, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// ../../node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject3(type.properties) : {};
}

// ../../node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// ../../node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// ../../node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types2) {
  return types2.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray2(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types2) {
  const evaluated = EvaluateIntersect(types2);
  const result = FromType9(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types2) {
  return types2.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// ../../node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// ../../node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// ../../node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types2) {
  return types2.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject4(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// ../../node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types2) {
  return types2.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// ../../node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types2, indexer) {
  return types2.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types2, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types2, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types2) {
  return EvaluateUnionFast(types2);
}
function FromTuple2(types2, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types2.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types2) : FromTupleWithIndexer(types2, indexer)
  );
}

// ../../node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray2(type.items, indexer) : IsObject2(type) ? FromObject4(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// ../../node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// ../../node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// ../../node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray3(_type) {
  return Number2();
}

// ../../node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject5(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// ../../node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// ../../node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types2) {
  const result = types2.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// ../../node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray3(type.items) : IsObject2(type) ? FromObject5(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// ../../node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}

// ../../node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types2) {
  return types2.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// ../../node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// ../../node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options);
}

// ../../node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}

// ../../node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}

// ../../node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// ../../node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted2 = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted2);
  return result;
}

// ../../node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// ../../node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// ../../node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types2) {
  const evaluated = EvaluateIntersect(types2);
  const result = FromType15(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types2) {
  const result = types2.map((type) => FromType15(type));
  return Union(result);
}

// ../../node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject6(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// ../../node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject6(type.properties) : _Object_({});
}

// ../../node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}

// ../../node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// ../../node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// ../../node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType = ReadonlyObject;

// ../../node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray4(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types2) {
  const evaluated = EvaluateIntersect(types2);
  const result = FromType17(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types2) {
  const result = AddImmutable(Tuple(types2));
  return result;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types2) {
  const result = types2.map((type) => FromType17(type));
  return Union(result);
}

// ../../node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray4(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject7(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// ../../node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}

// ../../node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// ../../node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types2) {
  const evaluated = EvaluateIntersect(types2);
  const result = FromType18(evaluated);
  return result;
}

// ../../node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types2) {
  const result = types2.map((type) => FromType18(type));
  return Union(result);
}

// ../../node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// ../../node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject8(type.properties) : _Object_({});
}

// ../../node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options);
}

// ../../node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}

// ../../node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options);
}

// ../../node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types2) {
  const result = types2.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// ../../node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited) {
  return { callstack, visited };
}
function CanInstantiate(types2) {
  return guard_exports.ShiftLeft(types2, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types2) {
  const elements = InstantiateTypes(context, state, types2);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types2) {
  return types2.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// ../../node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options);
}

// ../../node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// ../../node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// ../../node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}

// ../../node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}

// ../../node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// ../../packages/core/src/clangd.ts
import { execFile, spawn } from "node:child_process";
import { readFile as readFile2 } from "node:fs/promises";
import { resolve as resolve3, extname as extname2 } from "node:path";
import { fileURLToPath, pathToFileURL as pathToFileURL2 } from "node:url";

// ../../packages/core/src/build.ts
var MAX_TIMEOUT_MS = 6e5;
var timeoutParameter = typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS, description: "Command timeout in milliseconds (default: 120000, maximum: 600000)" }));
var commonParameters = {
  build_dir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, description: "Configured CMake build directory (default: the extension's managed build directory when the CMake project model is ready, otherwise 'build')" })),
  config: typebox_exports.Optional(typebox_exports.String({ minLength: 1, description: "Build configuration, for example Debug or Release" })),
  parallel: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, description: "Maximum parallel jobs" })),
  timeout_ms: timeoutParameter
};

// ../../packages/core/src/compdb.ts
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
function canonical(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}
function checkCompiler(compiler) {
  if (!/^(?:clang(?:\+\+)?|gcc|g\+\+|cc|c\+\+)(?:-\d+(?:\.\d+)*)?$/.test(basename(compiler)) && !/^[\w.+-]+-(?:gcc|g\+\+|clang(?:\+\+)?)(?:-\d+(?:\.\d+)*)?$/.test(basename(compiler))) {
    throw new Error(`Unsupported compiler '${compiler}': use a GCC/Clang driver directly (wrappers and MSVC commands are unsupported)`);
  }
}
function isModuleScanArgument(arg) {
  return arg === "-fmodules-ts" || /^-fmodule-mapper=/.test(arg) || /^-fdeps-(?:format|file|target)=/.test(arg) || arg.startsWith("@") && arg.endsWith(".modmap");
}
function syntaxArguments(args, standard) {
  const result = [];
  const takesOutput = /* @__PURE__ */ new Set(["-o", "--output", "-MF", "-MT", "-MQ", "-MJ", "-dependency-file", "--serialize-diagnostics", "-serialize-diagnostics"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (isModuleScanArgument(arg)) continue;
    if (arg.startsWith("@")) throw new Error("Response files are unsupported for syntax checks; expand them in compile_commands.json");
    if (arg === "--") throw new Error("The compiler '--' delimiter is unsupported for syntax checks");
    if (takesOutput.has(arg)) {
      if (++i >= args.length) throw new Error(`Missing value for compiler flag ${arg}`);
      continue;
    }
    if (/^(?:-o.+|--output=|-M[FTQJ].+|-{1,2}serialize-diagnostics=)/.test(arg)) continue;
    if (["-c", "-S", "-E", "-M", "-MM", "-MD", "-MMD", "-MP", "-MG", "-fsyntax-only", "--coverage", "-ftest-coverage", "-fprofile-arcs", "-gsplit-dwarf"].includes(arg)) continue;
    if (/^-save-temps(?:=|$)/.test(arg)) continue;
    if (/^(?:-Wp,|-Xclang|-Xpreprocessor|-fplugin|-fmodules|-fmodule-|-fprofile|-ftime-trace|-fsave-optimization-record|-foptimization-record|-fdiagnostics-serialization|-fdiagnostics-format=(?:sarif|json)-file|-fdump|-aux-info|-dump|-emit-|--analyze)/.test(arg)) {
      throw new Error(`Unsupported compiler flag for an artifact-free syntax check: ${arg}`);
    }
    if (standard !== void 0 && /^-std(?:=|$)/.test(arg)) {
      if (arg === "-std") i++;
      continue;
    }
    result.push(arg);
  }
  if (standard !== void 0) result.push(`-std=${standard}`);
  result.push("-fsyntax-only");
  return result;
}
function entryCompiler(compiler, directory) {
  return compiler.includes("/") && !isAbsolute(compiler) ? resolve(directory, compiler) : compiler;
}
function probeInvocation(entry) {
  checkCompiler(entry.argv[0] ?? "");
  const args = syntaxArguments(entry.argv.slice(1)).filter((arg) => arg !== "-fsyntax-only" && canonical(resolve(entry.directory, arg)) !== entry.file);
  return { compiler: entryCompiler(entry.argv[0], entry.directory), args, cwd: entry.directory };
}

// ../../packages/core/src/navigation.ts
import { readFile } from "node:fs/promises";
import { resolve as resolve2 } from "node:path";
import { pathToFileURL } from "node:url";
var MAX_ENTRIES = 100;
var MAX_OUTLINE = 300;
var SYMBOL_KINDS = ["", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enumerator", "struct", "event", "operator", "type parameter"];
function kindName(kind) {
  return typeof kind === "number" && SYMBOL_KINDS[kind] || "symbol";
}
function at(value) {
  return `${value.file}:${value.line}:${value.column}`;
}
function itemLocation(item) {
  return location({ uri: item?.uri, range: item?.selectionRange ?? item?.range });
}
function omitted(count, noun) {
  return count > 0 ? [`[${count} more ${noun} omitted]`] : [];
}
var positionParameters = {
  file: typebox_exports.String({ description: "Source or header path, absolute or relative to the project cwd" }),
  line: typebox_exports.Integer({ minimum: 1, description: "1-based line" }),
  column: typebox_exports.Integer({ minimum: 1, description: "1-based UTF-16 column (JavaScript string offsets + 1)" })
};
var references = {
  name: "cpp_references",
  label: "C++ References",
  description: "Find all references to the C/C++ symbol at a position across the CMake project, using clangd's project index. Returns 1-based file:line:column locations, including the declaration and definition.",
  promptSnippet: "Find every reference to a C/C++ symbol with clangd instead of grep",
  parameters: typebox_exports.Object(positionParameters),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const input = await position(cwd, params);
    const result = await (await connect()).request("textDocument/references", { ...input.request, context: { includeDeclaration: true } }, { file: input.file, signal });
    const all = Array.isArray(result) ? result : [];
    const locations = all.slice(0, MAX_ENTRIES).map(location);
    const text = locations.length ? [...locations.map(at), ...omitted(all.length - locations.length, "references")].join("\n") : "No references found at this position.";
    return { text, found: locations.length > 0, details: { file: input.file, line: input.line, column: input.column, locations, omitted: all.length - locations.length } };
  }
};
function outline(symbols2, lines, depth) {
  let total = 0;
  for (const symbol of symbols2) {
    total++;
    if (lines.length < MAX_OUTLINE) {
      const start = (symbol.selectionRange ?? symbol.location?.range ?? symbol.range)?.start;
      const kind = kindName(symbol.kind);
      const detail = symbol.detail && symbol.detail !== kind ? `: ${symbol.detail}` : "";
      lines.push(`${"  ".repeat(depth)}${kind} ${symbol.name}${detail}${start ? `  ${start.line + 1}:${start.character + 1}` : ""}`);
    }
    if (Array.isArray(symbol.children)) total += outline(symbol.children, lines, depth + 1);
  }
  return total;
}
var symbols = {
  name: "cpp_symbols",
  label: "C++ Symbols",
  description: "Search C/C++ symbols by name across the CMake project (query), or list the outline of one file (file) with members nested under their class. Returns 1-based locations.",
  promptSnippet: "Search C/C++ symbols by name across the project, or outline a file, with clangd",
  parameters: typebox_exports.Object({
    query: typebox_exports.Optional(typebox_exports.String({ minLength: 1, description: "Symbol name or fuzzy fragment to search the whole project for" })),
    file: typebox_exports.Optional(typebox_exports.String({ minLength: 1, description: "File to outline, absolute or relative to the project cwd" }))
  }),
  indexed: (params) => params.query !== void 0,
  async run(params, cwd, connect, signal) {
    if (params.query === void 0 === (params.file === void 0)) {
      throw new Error("cpp_symbols takes either query or file: query searches the project by name, file outlines one file.");
    }
    if (params.query !== void 0) {
      const result2 = await (await connect()).request("workspace/symbol", { query: params.query }, { signal });
      const all = Array.isArray(result2) ? result2 : [];
      const found = all.slice(0, MAX_ENTRIES).map((symbol) => ({
        name: symbol.containerName ? `${symbol.containerName}::${symbol.name}` : symbol.name,
        kind: kindName(symbol.kind),
        ...location(symbol.location ?? symbol)
      }));
      const text2 = found.length ? [...found.map((symbol) => `${at(symbol)}  ${symbol.kind} ${symbol.name}`), ...omitted(all.length - found.length, "symbols")].join("\n") : `No symbols match "${params.query}".`;
      return { text: text2, found: found.length > 0, details: { query: params.query, symbols: found, omitted: all.length - found.length } };
    }
    const file = resolve2(cwd, params.file);
    await readFile(file, "utf8");
    const result = await (await connect()).request("textDocument/documentSymbol", { textDocument: { uri: pathToFileURL(file).href } }, { file, signal });
    const lines = [];
    const total = outline(Array.isArray(result) ? result : [], lines, 0);
    const text = total ? [file, ...lines, ...omitted(total - lines.length, "outline entries")].join("\n") : `No symbols in ${file}.`;
    return { text, found: total > 0, details: { file, outline: lines, omitted: total - lines.length } };
  }
};
async function hierarchy(params, cwd, connect, signal, prepare, method) {
  const input = await position(cwd, params);
  const connection = await connect();
  const prepared = await connection.request(prepare, input.request, { file: input.file, signal });
  const items = Array.isArray(prepared) ? prepared : [];
  const results = [];
  for (const item of items) {
    const result = await connection.request(method, { item }, { signal });
    results.push({ from: item, result: Array.isArray(result) ? result : [] });
  }
  return { input, items, results };
}
var calls = {
  name: "cpp_calls",
  label: "C++ Calls",
  description: "List the incoming calls (callers) or outgoing calls (callees) of the C/C++ function at a position, using clangd's call hierarchy and project index. Returns 1-based locations.",
  promptSnippet: "Find the callers or callees of a C/C++ function with clangd",
  parameters: typebox_exports.Object({
    ...positionParameters,
    direction: typebox_exports.Enum(["incoming", "outgoing"], { description: "incoming (who calls it) | outgoing (what it calls)" })
  }),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const { input, items, results } = await hierarchy(params, cwd, connect, signal, "textDocument/prepareCallHierarchy", `callHierarchy/${params.direction}Calls`);
    const incoming = params.direction === "incoming";
    const verb = incoming ? "calls it at" : "called at";
    const base = { file: input.file, line: input.line, column: input.column, direction: params.direction };
    if (!items.length) return { text: "No function at this position.", found: false, details: { ...base, calls: [], omitted: 0 } };
    const entries = results.flatMap(({ from, result }) => result.map((call) => {
      const other = incoming ? call.from : call.to;
      const siteFile = itemLocation(incoming ? other : from).file;
      const sites = (Array.isArray(call.fromRanges) ? call.fromRanges : []).map((range) => location({ uri: pathToFileURL(siteFile).href, range }));
      return { name: other?.name, ...itemLocation(other), sites };
    }));
    const shown = entries.slice(0, MAX_ENTRIES);
    const lines = shown.map((entry) => {
      const sites = entry.sites.map((site) => incoming ? `${site.line}:${site.column}` : at(site)).join(", ");
      return `${at(entry)}  ${entry.name}${sites ? `  (${verb} ${sites})` : ""}`;
    });
    const name = items.map((item) => item.name).join(", ");
    const text = shown.length ? [...lines, ...omitted(entries.length - shown.length, "calls")].join("\n") : `No ${params.direction} calls found for ${name}.`;
    return { text, found: shown.length > 0, details: { ...base, calls: shown, omitted: entries.length - shown.length } };
  }
};
var types = {
  name: "cpp_types",
  label: "C++ Types",
  description: "List the base classes (supertypes) or derived classes (subtypes) of the C/C++ type at a position, using clangd's type hierarchy and project index. Returns 1-based locations.",
  promptSnippet: "Find the base or derived classes of a C++ type with clangd",
  parameters: typebox_exports.Object({
    ...positionParameters,
    direction: typebox_exports.Enum(["supertypes", "subtypes"], { description: "supertypes (base classes) | subtypes (derived classes)" })
  }),
  indexed: () => true,
  async run(params, cwd, connect, signal) {
    const { input, items, results } = await hierarchy(params, cwd, connect, signal, "textDocument/prepareTypeHierarchy", `typeHierarchy/${params.direction}`);
    const base = { file: input.file, line: input.line, column: input.column, direction: params.direction };
    if (!items.length) return { text: "No type at this position.", found: false, details: { ...base, types: [], omitted: 0 } };
    const entries = results.flatMap(({ result }) => result.map((item) => ({ name: item.name, kind: kindName(item.kind), ...itemLocation(item) })));
    const shown = entries.slice(0, MAX_ENTRIES);
    const name = items.map((item) => item.name).join(", ");
    const text = shown.length ? [...shown.map((entry) => `${at(entry)}  ${entry.kind} ${entry.name}`), ...omitted(entries.length - shown.length, "types")].join("\n") : `No ${params.direction} found for ${name}.`;
    return { text, found: shown.length > 0, details: { ...base, types: shown, omitted: entries.length - shown.length } };
  }
};

// ../../packages/core/src/project/briefing.ts
var SUMMARY_FEATURE_SHARE = 1 / 3;

// ../../packages/core/src/clangd.ts
var MAX_MESSAGE = 16 * 1024 * 1024;
var INDEX_TOKEN = "backgroundIndexProgress";
var METHOD_NOT_FOUND = -32601;
var ClangdUnsupportedError = class extends Error {
  method;
  constructor(method) {
    super(`${method} is not supported by this clangd version`);
    this.name = "ClangdUnsupportedError";
    this.method = method;
  }
};
function aborted() {
  return new Error("clangd request cancelled");
}
function checkSignal(signal) {
  if (signal?.aborted) throw aborted();
}
function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve5, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve5, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}
function checkPosition(text, line, column) {
  const lines = text.split(/\r\n|\n|\r/);
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length || column > lines[line - 1].length + 1) {
    throw new Error("Position is outside the file. line and column must be positive, 1-based UTF-16 positions.");
  }
}
async function position(cwd, params) {
  const file = resolve3(cwd, params.file);
  const { line, column } = params;
  checkPosition(await readFile2(file, "utf8"), line, column);
  return { file, line, column, request: { textDocument: { uri: pathToFileURL2(file).href }, position: { line: line - 1, character: column - 1 } } };
}
var ClangdConnection = class {
  child;
  buffer = Buffer.alloc(0);
  pending = /* @__PURE__ */ new Map();
  nextId = 0;
  stderr = "";
  documents = /* @__PURE__ */ new Map();
  queue = Promise.resolve();
  ready;
  capabilities = {};
  diagnostics = /* @__PURE__ */ new Map();
  diagnosticsWaiters = /* @__PURE__ */ new Set();
  index = "not-started";
  indexWaiters = /* @__PURE__ */ new Set();
  unsupported = /* @__PURE__ */ new Set();
  dead = false;
  closing = false;
  get alive() {
    return !this.dead && !this.closing;
  }
  cwd;
  buildDir;
  options;
  constructor(cwd, buildDir, options = {}) {
    this.cwd = cwd;
    this.buildDir = buildDir;
    this.options = options;
    const flagName = (arg) => arg.split("=")[0];
    const overridden = new Set((options.extraArgs ?? []).map(flagName));
    const defaults = ["--background-index=false", "--log=error"].filter((flag) => !overridden.has(flagName(flag)));
    this.child = spawn(options.command ?? "clangd", [
      ...options.args ?? [],
      ...defaults,
      ...buildDir ? [`--compile-commands-dir=${buildDir}`] : [],
      ...options.extraArgs ?? []
    ], { cwd, stdio: "pipe" });
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4e3);
    });
    this.child.on("error", (error) => this.fail(new Error(`Could not start clangd: ${error.message}. Install clangd and ensure it is on PATH.`)));
    this.child.on("exit", (code, signal) => this.fail(new Error(`clangd exited (${signal ?? code}). ${this.stderr}`)));
    this.child.stdin.on("error", (error) => this.fail(new Error(`clangd stdin failed: ${error.message}`)));
    this.child.stdout.on("end", () => this.fail(new Error(`clangd closed its output. ${this.stderr}`)));
    this.ready = this.initialize();
    void this.ready.catch(() => {
    });
  }
  async initialize() {
    const result = await this.call("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL2(this.cwd).href,
      workspaceFolders: [{ uri: pathToFileURL2(this.cwd).href, name: this.cwd }],
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        offsetEncoding: ["utf-16"],
        window: { workDoneProgress: true },
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { versionSupport: true, relatedInformation: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          rename: { prepareSupport: true },
          callHierarchy: {},
          typeHierarchy: {}
        }
      }
    });
    this.capabilities = result?.capabilities ?? {};
    if ((result?.capabilities?.positionEncoding ?? result?.offsetEncoding ?? "utf-16") !== "utf-16") {
      this.fail(new Error("clangd selected an unsupported position encoding (expected UTF-16)"));
      throw new Error("clangd selected an unsupported position encoding");
    }
    this.send({ method: "initialized", params: {} });
  }
  send(message) {
    if (this.dead) throw new Error("clangd connection is closed");
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r
\r
${body}`);
  }
  receive(chunk) {
    if (this.dead) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (; ; ) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          if (this.buffer.length > 8192) throw new Error("LSP header too large");
          return;
        }
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(this.buffer.subarray(0, headerEnd).toString("ascii"));
        if (!match) throw new Error("missing Content-Length");
        const length = Number(match[1]);
        if (length > MAX_MESSAGE) throw new Error("LSP message too large");
        if (this.buffer.length < headerEnd + 4 + length) return;
        const message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        this.buffer = this.buffer.subarray(headerEnd + 4 + length);
        if (message.method) {
          if (message.id !== void 0) {
            if (message.method === "window/workDoneProgress/create") this.send({ id: message.id, result: null });
            else if (message.method === "workspace/configuration") this.send({ id: message.id, result: (message.params?.items ?? []).map(() => null) });
            else if (message.method === "workspace/workspaceFolders") this.send({ id: message.id, result: [{ uri: pathToFileURL2(this.cwd).href, name: this.cwd }] });
            else this.send({ id: message.id, error: { code: METHOD_NOT_FOUND, message: `Unsupported client method: ${message.method}` } });
          } else if (message.method === "$/progress") this.progress(message.params);
          else if (message.method === "textDocument/publishDiagnostics") this.publishDiagnostics(message.params);
          continue;
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : void 0;
        if (pending) {
          this.pending.delete(message.id);
          pending.cleanup();
          if (message.error) pending.reject(message.error.code === METHOD_NOT_FOUND ? Object.assign(new Error("method not found"), { methodNotFound: true }) : new Error(`clangd: ${message.error.message} (${message.error.code})`));
          else pending.resolve(message.result);
        }
      }
    } catch (error) {
      this.fail(new Error(`Invalid clangd protocol: ${error.message}`));
    }
  }
  progress(params) {
    if (params?.token !== INDEX_TOKEN) return;
    const kind = params.value?.kind;
    if (kind === "begin" || kind === "report") this.index = "indexing";
    else if (kind === "end") {
      this.index = "idle";
      for (const wake of this.indexWaiters) wake();
    }
  }
  publishDiagnostics(params) {
    if (typeof params?.uri !== "string") return;
    const entry = { version: typeof params.version === "number" ? params.version : void 0, diagnostics: Array.isArray(params.diagnostics) ? params.diagnostics : [] };
    this.diagnostics.set(params.uri, entry);
    for (const waiter of this.diagnosticsWaiters) {
      if (waiter.uri === params.uri && entry.version !== void 0 && entry.version >= waiter.version) waiter.resolve({ status: "ready", version: entry.version, diagnostics: entry.diagnostics });
    }
  }
  /** Sends one request. A method-not-found reply is remembered and later calls fail without a request. */
  call(method, params, signal) {
    checkSignal(signal);
    if (this.unsupported.has(method)) return Promise.reject(new ClangdUnsupportedError(method));
    if (this.dead) return Promise.reject(new Error("clangd connection is closed"));
    const id = ++this.nextId;
    return new Promise((resolve5, reject) => {
      const cancel = () => {
        this.pending.delete(id);
        cleanup();
        try {
          this.send({ method: "$/cancelRequest", params: { id } });
        } catch {
        }
        reject(aborted());
      };
      const timer = setTimeout(() => this.fail(new Error(`clangd ${method} timed out after ${this.options.timeoutMs ?? 3e4}ms`)), this.options.timeoutMs ?? 3e4);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      this.pending.set(id, { resolve: resolve5, reject, cleanup });
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        this.send({ id, method, params });
      } catch (error) {
        this.fail(error);
      }
    }).catch((error) => {
      if (!error.methodNotFound) throw error;
      this.unsupported.add(method);
      throw new ClangdUnsupportedError(method);
    });
  }
  fail(error) {
    if (this.dead) return;
    this.dead = true;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    this.documents.clear();
    this.diagnostics.clear();
    this.child.kill("SIGKILL");
  }
  /** Runs one operation at a time, after initialization, so document versions stay ordered. */
  serialize(signal, operation) {
    checkSignal(signal);
    const run = this.queue.then(async () => {
      checkSignal(signal);
      await waitFor(this.ready, signal);
      checkSignal(signal);
      return operation();
    });
    this.queue = run.catch(() => {
    });
    return waitFor(run, signal);
  }
  /**
   * Refreshes every open document from disk and, when `file` is given,
   * reopens it from disk. `check` can reject the saved text before anything
   * is sent. Must run inside `serialize`.
   */
  async refresh(file, signal, check) {
    const text = file === void 0 ? void 0 : await readFile2(file, "utf8");
    checkSignal(signal);
    if (text !== void 0) check?.(text);
    const uri = file === void 0 ? void 0 : pathToFileURL2(file).href;
    for (const [openUri, document] of this.documents) {
      if (openUri === uri) continue;
      let current;
      try {
        current = await readFile2(fileURLToPath(openUri), "utf8");
      } catch {
        this.send({ method: "textDocument/didClose", params: { textDocument: { uri: openUri } } });
        this.documents.delete(openUri);
        continue;
      }
      checkSignal(signal);
      if (current !== document.text) {
        const version2 = document.version + 1;
        this.send({ method: "textDocument/didChange", params: { textDocument: { uri: openUri, version: version2 }, contentChanges: [{ text: current }] } });
        this.documents.set(openUri, { text: current, version: version2 });
      }
    }
    if (file === void 0 || uri === void 0 || text === void 0) return void 0;
    const previous = this.documents.get(uri);
    const version = (previous?.version ?? 0) + 1;
    if (previous) this.send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
    this.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: extname2(file) === ".c" ? "c" : "cpp", version, text } } });
    this.documents.set(uri, { text, version });
    return { uri, version };
  }
  /** Server capabilities from the `initialize` result. */
  async serverCapabilities() {
    await this.ready;
    return this.capabilities;
  }
  /** Background index state; "not-started" until clangd reports progress, and it counts as incomplete. */
  get indexState() {
    return this.index;
  }
  /** Waits up to `timeoutMs` for the background index to be idle and returns the state reached. */
  waitForIndexIdle(timeoutMs, signal) {
    if (this.index === "idle") return Promise.resolve(this.index);
    return waitFor(new Promise((done) => {
      const finish = () => {
        clearTimeout(timer);
        this.indexWaiters.delete(finish);
        done(this.index);
      };
      const timer = setTimeout(finish, timeoutMs);
      this.indexWaiters.add(finish);
    }), signal);
  }
  /** The text clangd last received for `file`, or undefined when it is not open (clangd then reads it from disk). */
  syncedText(file) {
    return this.documents.get(pathToFileURL2(file).href)?.text;
  }
  /** Opens `file` from disk (and refreshes other open documents); returns the version clangd now has. */
  syncFile(file, signal) {
    return this.serialize(signal, async () => await this.refresh(file, signal));
  }
  /**
   * Waits up to `timeoutMs` for diagnostics of `file` at `version` or newer.
   * Older versions are ignored; a timeout returns `{ status: "pending" }`.
   */
  waitForDiagnostics(file, version, timeoutMs, signal) {
    const uri = pathToFileURL2(file).href;
    const stored = this.diagnostics.get(uri);
    if (stored?.version !== void 0 && stored.version >= version) return Promise.resolve({ status: "ready", version: stored.version, diagnostics: stored.diagnostics });
    return waitFor(new Promise((done) => {
      const waiter = { uri, version, resolve: (result) => {
        clearTimeout(timer);
        this.diagnosticsWaiters.delete(waiter);
        done(result);
      } };
      const timer = setTimeout(() => waiter.resolve({ status: "pending" }), timeoutMs);
      this.diagnosticsWaiters.add(waiter);
    }), signal);
  }
  /**
   * Sends an LSP request and returns its result. Open documents are refreshed
   * from disk first, and `file`, when given, is reopened from disk. Rejects
   * with `ClangdUnsupportedError` when clangd lacks the method.
   */
  request(method, params, options = {}) {
    const { file, signal } = options;
    checkSignal(signal);
    if (this.unsupported.has(method)) return Promise.reject(new ClangdUnsupportedError(method));
    return this.serialize(signal, async () => {
      await this.refresh(file, signal);
      return this.call(method, params, signal);
    });
  }
  async query(method, file, line, column, signal) {
    return this.serialize(signal, async () => {
      const synced = await this.refresh(file, signal, (text) => checkPosition(text, line, column));
      return this.call(`textDocument/${method}`, { textDocument: { uri: synced.uri }, position: { line: line - 1, character: column - 1 } }, signal);
    });
  }
  async close() {
    if (this.dead || this.closing) return;
    this.closing = true;
    const timer = setTimeout(() => this.fail(new Error("clangd shutdown timed out")), 1e3);
    try {
      await this.ready;
      await this.call("shutdown", null);
      this.send({ method: "exit" });
    } catch {
    } finally {
      clearTimeout(timer);
      this.fail(new Error("clangd session shut down"));
    }
  }
};
function location(value) {
  const uri = value.targetUri ?? value.uri;
  const range = value.targetSelectionRange ?? value.range;
  if (typeof uri !== "string" || !range?.start || !range?.end) throw new Error("clangd returned an invalid definition location");
  return {
    file: uri.startsWith("file:") ? fileURLToPath(uri) : uri,
    line: range.start.line + 1,
    column: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1
  };
}

// ../../packages/core/src/toolchain.ts
var STANDARDS = [11, 14, 17, 20, 23, 26];
var REFLECTION_FLAGS = { gcc: "-freflection" };
var MODULE_FLAGS = { gcc: "-fmodules" };
var language = (id, label, macro, min, extra = {}) => ({ id, label, kind: "language", macro, min, ...extra });
var library = (id, label, macro, min, extra = {}) => ({ id, label, kind: "library", macro, min, ...extra });
var of = (standard, entries) => entries.map((entry) => ({ standard, ...entry }));
var FEATURES = [
  // C++11 library additions predate the library feature-test macros, so C++11 lists language features only.
  ...of(11, [
    language("rvalue_references", "rvalue references", "__cpp_rvalue_references", 200610),
    language("lambdas", "lambdas", "__cpp_lambdas", 200907),
    language("constexpr", "constexpr", "__cpp_constexpr", 200704),
    language("variadic_templates", "variadic templates", "__cpp_variadic_templates", 200704),
    language("static_assert", "static_assert", "__cpp_static_assert", 200410),
    language("decltype", "decltype", "__cpp_decltype", 200707),
    language("alias_templates", "alias templates", "__cpp_alias_templates", 200704),
    language("range_based_for", "range-based for", "__cpp_range_based_for", 200907),
    language("initializer_lists", "initializer lists", "__cpp_initializer_lists", 200806),
    language("delegating_constructors", "delegating constructors", "__cpp_delegating_constructors", 200604),
    language("inheriting_constructors", "inheriting constructors", "__cpp_inheriting_constructors", 200802),
    language("nsdmi", "default member initializers", "__cpp_nsdmi", 200809),
    language("raw_strings", "raw string literals", "__cpp_raw_strings", 200710),
    language("unicode_literals", "unicode string literals", "__cpp_unicode_literals", 200710),
    language("user_defined_literals", "user-defined literals", "__cpp_user_defined_literals", 200809),
    language("attributes", "attributes", "__cpp_attributes", 200809),
    language("ref_qualifiers", "ref-qualified member functions", "__cpp_ref_qualifiers", 200710),
    language("threadsafe_static_init", "thread-safe static initialization", "__cpp_threadsafe_static_init", 200806)
  ]),
  ...of(14, [
    language("generic_lambdas", "generic lambdas", "__cpp_generic_lambdas", 201304),
    language("init_captures", "init captures", "__cpp_init_captures", 201304),
    language("relaxed_constexpr", "relaxed constexpr", "__cpp_constexpr", 201304),
    language("return_type_deduction", "return type deduction", "__cpp_return_type_deduction", 201304),
    language("decltype_auto", "decltype(auto)", "__cpp_decltype_auto", 201304),
    language("binary_literals", "binary literals", "__cpp_binary_literals", 201304),
    language("variable_templates", "variable templates", "__cpp_variable_templates", 201304),
    language("aggregate_nsdmi", "aggregates with default member initializers", "__cpp_aggregate_nsdmi", 201304),
    language("sized_deallocation", "sized deallocation", "__cpp_sized_deallocation", 201309),
    library("make_unique", "std::make_unique", "__cpp_lib_make_unique", 201304),
    library("integer_sequence", "std::integer_sequence", "__cpp_lib_integer_sequence", 201304),
    library("exchange", "std::exchange", "__cpp_lib_exchange_function", 201304),
    library("shared_timed_mutex", "std::shared_timed_mutex", "__cpp_lib_shared_timed_mutex", 201402),
    library("chrono_udls", "chrono literals", "__cpp_lib_chrono_udls", 201304),
    library("string_udls", 'string literals ("s"s)', "__cpp_lib_string_udls", 201304),
    library("transparent_operators", "transparent comparators", "__cpp_lib_transparent_operators", 201210),
    library("quoted", "std::quoted", "__cpp_lib_quoted_string_io", 201304)
  ]),
  ...of(17, [
    language("structured_bindings", "structured bindings", "__cpp_structured_bindings", 201606),
    language("if_constexpr", "if constexpr", "__cpp_if_constexpr", 201606),
    language("inline_variables", "inline variables", "__cpp_inline_variables", 201606),
    language("fold_expressions", "fold expressions", "__cpp_fold_expressions", 201603),
    language("deduction_guides", "class template argument deduction", "__cpp_deduction_guides", 201703),
    language("auto_template_parameters", "auto template parameters", "__cpp_nontype_template_parameter_auto", 201606),
    language("guaranteed_copy_elision", "guaranteed copy elision", "__cpp_guaranteed_copy_elision", 201606),
    language("aligned_new", "aligned new", "__cpp_aligned_new", 201606),
    language("noexcept_function_type", "noexcept in the type system", "__cpp_noexcept_function_type", 201510),
    language("hex_float", "hexadecimal float literals", "__cpp_hex_float", 201603),
    language("constexpr_lambda", "constexpr lambdas", "__cpp_constexpr", 201603),
    language("capture_star_this", "capturing *this", "__cpp_capture_star_this", 201603),
    language("aggregate_bases", "aggregates with base classes", "__cpp_aggregate_bases", 201603),
    language("variadic_using", "variadic using declarations", "__cpp_variadic_using", 201611),
    library("optional", "std::optional", "__cpp_lib_optional", 201606),
    library("variant", "std::variant", "__cpp_lib_variant", 201606),
    library("any", "std::any", "__cpp_lib_any", 201606),
    library("string_view", "std::string_view", "__cpp_lib_string_view", 201606),
    library("filesystem", "std::filesystem", "__cpp_lib_filesystem", 201703),
    library("apply", "std::apply", "__cpp_lib_apply", 201603),
    library("invoke", "std::invoke", "__cpp_lib_invoke", 201411),
    library("byte", "std::byte", "__cpp_lib_byte", 201603),
    library("to_chars", "std::to_chars", "__cpp_lib_to_chars", 201611),
    library("shared_mutex", "std::shared_mutex", "__cpp_lib_shared_mutex", 201505),
    library("scoped_lock", "std::scoped_lock", "__cpp_lib_scoped_lock", 201703),
    library("gcd_lcm", "std::gcd and std::lcm", "__cpp_lib_gcd_lcm", 201606),
    library("parallel_algorithm", "parallel algorithms", "__cpp_lib_parallel_algorithm", 201603)
  ]),
  ...of(20, [
    language("concepts", "concepts", "__cpp_concepts", 201907),
    language("coroutines", "coroutines", "__cpp_impl_coroutine", 201902),
    language("modules", "modules", "__cpp_modules", 1, { enable: MODULE_FLAGS }),
    language("three_way_comparison", "three-way comparison (<=>)", "__cpp_impl_three_way_comparison", 201907),
    language("consteval", "consteval", "__cpp_consteval", 201811),
    language("constinit", "constinit", "__cpp_constinit", 201907),
    language("designated_initializers", "designated initializers", "__cpp_designated_initializers", 201707),
    language("char8_t", "char8_t", "__cpp_char8_t", 201811),
    language("using_enum", "using enum", "__cpp_using_enum", 201907),
    language("aggregate_paren_init", "parenthesized aggregate initialization", "__cpp_aggregate_paren_init", 201902),
    language("conditional_explicit", "conditional explicit", "__cpp_conditional_explicit", 201806),
    language("constexpr_dynamic_alloc", "constexpr dynamic allocation", "__cpp_constexpr_dynamic_alloc", 201907),
    library("ranges", "ranges", "__cpp_lib_ranges", 201911),
    library("format", "std::format", "__cpp_lib_format", 201907),
    library("span", "std::span", "__cpp_lib_span", 202002),
    library("source_location", "std::source_location", "__cpp_lib_source_location", 201907),
    library("jthread", "std::jthread", "__cpp_lib_jthread", 201911),
    library("bit_cast", "std::bit_cast", "__cpp_lib_bit_cast", 201806),
    library("numbers", "<numbers>", "__cpp_lib_math_constants", 201907),
    library("semaphore", "<semaphore>", "__cpp_lib_semaphore", 201907)
  ]),
  ...of(23, [
    language("explicit_this", "deducing this", "__cpp_explicit_this_parameter", 202110),
    language("if_consteval", "if consteval", "__cpp_if_consteval", 202106),
    language("multidimensional_subscript", "multidimensional subscript", "__cpp_multidimensional_subscript", 202110),
    language("static_call_operator", "static operator()", "__cpp_static_call_operator", 202207),
    language("auto_cast", "auto(x)", "__cpp_auto_cast", 202110),
    language("size_t_suffix", "the uz literal suffix", "__cpp_size_t_suffix", 202011),
    language("named_character_escapes", "named character escapes", "__cpp_named_character_escapes", 202207),
    language("implicit_move", "simpler implicit move", "__cpp_implicit_move", 202207),
    language("float16", "std::float16_t", "__STDCPP_FLOAT16_T__", 1),
    language("assume", "[[assume]]", void 0, void 0, { alternative: "defined(__has_cpp_attribute) && __has_cpp_attribute(assume) >= 202207L" }),
    library("expected", "std::expected", "__cpp_lib_expected", 202211),
    library("print", "std::print", "__cpp_lib_print", 202207),
    library("mdspan", "std::mdspan", "__cpp_lib_mdspan", 202207),
    library("generator", "std::generator", "__cpp_lib_generator", 202207),
    library("flat_map", "std::flat_map", "__cpp_lib_flat_map", 202207),
    library("stacktrace", "std::stacktrace", "__cpp_lib_stacktrace", 202011),
    library("import_std", "import std", "__cpp_lib_modules", 202207, { enable: MODULE_FLAGS }),
    library("ranges_to", "ranges::to", "__cpp_lib_ranges_to_container", 202202),
    library("unreachable", "std::unreachable", "__cpp_lib_unreachable", 202202),
    library("move_only_function", "std::move_only_function", "__cpp_lib_move_only_function", 202110),
    library("byteswap", "std::byteswap", "__cpp_lib_byteswap", 202110),
    library("string_contains", "string::contains", "__cpp_lib_string_contains", 202011)
  ]),
  ...of(26, [
    language("reflection", "static reflection", "__cpp_impl_reflection", 202506, { enable: REFLECTION_FLAGS }),
    language("contracts", "contracts", "__cpp_contracts", 202502),
    language("pack_indexing", "pack indexing", "__cpp_pack_indexing", 202311),
    language("embed", "#embed", "__cpp_pp_embed", 202502, { alternative: "defined(__has_embed)" }),
    language("expansion_statements", "expansion statements", "__cpp_expansion_statements", 202506),
    language("constexpr_exceptions", "constexpr exceptions", "__cpp_constexpr_exceptions", 202411),
    language("placeholder_variables", "the _ placeholder", "__cpp_placeholder_variables", 202306),
    language("deleted_function", '= delete("reason")', "__cpp_deleted_function", 202403),
    language("structured_binding_packs", "structured binding packs", "__cpp_structured_bindings", 202411),
    language("variadic_friend", "variadic friends", "__cpp_variadic_friend", 202403),
    language("trivial_relocatability", "trivial relocatability", "__cpp_trivial_relocatability", 202502),
    library("meta", "<meta>", "__cpp_lib_reflection", 202506, { enable: REFLECTION_FLAGS }),
    library("inplace_vector", "std::inplace_vector", "__cpp_lib_inplace_vector", 202406),
    library("saturation_arithmetic", "saturation arithmetic", "__cpp_lib_saturation_arithmetic", 202311),
    library("text_encoding", "std::text_encoding", "__cpp_lib_text_encoding", 202306),
    library("hive", "std::hive", "__cpp_lib_hive", 202502),
    library("execution", "std::execution", "__cpp_lib_senders", 202406),
    library("linalg", "std::linalg", "__cpp_lib_linalg", 202311),
    library("hardening", "library hardening", "__cpp_lib_hardened_array", 202502)
  ])
];
var featureById = new Map(FEATURES.map((feature) => [feature.id, feature]));
function sortFeatures(ids) {
  const order = new Map(FEATURES.map((feature, index) => [feature.id, index]));
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
}
function featureLabels(ids) {
  return sortFeatures(ids).map((id) => featureById.get(id)?.label ?? id).join(", ");
}
var PROBE_MARKER = "pi-cpp-lsp-feature:";
var PROBE_END = "end";
var MARKER_PATTERN = new RegExp(`${PROBE_MARKER}(\\w+)`);
var ALTERNATIVE_PREFIX = "PI_CPP_LSP_ALT_";
var PROBE_TIMEOUT_MS2 = 1e4;
var CLANGD_PROBE_TIMEOUT_MS = 15e3;
function condition(feature) {
  const parts = [];
  if (feature.macro) parts.push(`(defined(${feature.macro}) && ${feature.macro} >= ${feature.min ?? 1}L)`);
  if (feature.alternative) parts.push(`(${feature.alternative})`);
  return parts.join(" || ");
}
function probeSource(warnings) {
  const lines = ["#if __has_include(<version>)", "#include <version>", "#endif"];
  for (const feature of FEATURES) {
    if (warnings) lines.push(`#if ${condition(feature)}`, `#warning "${PROBE_MARKER}${feature.id}"`, "#endif");
    else if (feature.alternative) lines.push(`#if ${feature.alternative}`, `#define ${ALTERNATIVE_PREFIX}${feature.id} 1`, "#endif");
  }
  if (warnings) lines.push(`#warning "${PROBE_MARKER}${PROBE_END}"`);
  return `${lines.join("\n")}
`;
}
function parseMacros(dump) {
  const macros = /* @__PURE__ */ new Map();
  for (const match of dump.matchAll(/^#define ([A-Za-z_]\w*)(?:[ \t]+(.*))?$/gm)) macros.set(match[1], (match[2] ?? "").trim());
  return macros;
}
function presentFeatures(macros) {
  const present = /* @__PURE__ */ new Set();
  for (const feature of FEATURES) {
    const value = feature.macro ? Number.parseInt(macros.get(feature.macro) ?? "", 10) : Number.NaN;
    if (Number.isFinite(value) && value >= (feature.min ?? 1) || macros.has(`${ALTERNATIVE_PREFIX}${feature.id}`)) present.add(feature.id);
  }
  return present;
}
function familyOf(macros) {
  if (macros.has("__clang__")) return "clang";
  return macros.has("__GNUC__") ? "gcc" : "unknown";
}
function compilerName(compiler, family, macros) {
  const major = family === "clang" ? macros.get("__clang_major__") : family === "gcc" ? macros.get("__GNUC__") : void 0;
  return major ? `${basename2(compiler)} ${major}` : basename2(compiler);
}
function firstLines(text) {
  return text.trim().split("\n").slice(0, 3).join("\n");
}
async function withProbe(source, body) {
  const dir = mkdtempSync(join2(tmpdir(), "pi-cpp-lsp-probe-"));
  const probe = join2(dir, "probe.cpp");
  try {
    writeFileSync(probe, source);
    return await body(dir, probe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function probeFor(entry) {
  try {
    return probeInvocation(entry);
  } catch (error) {
    return { reason: error.message };
  }
}
async function measureCompiler(entry, exec, signal) {
  const invocation = probeFor(entry);
  if ("reason" in invocation) return { ok: false, reason: invocation.reason };
  const { compiler, args, cwd } = invocation;
  return withProbe(probeSource(false), async (_dir, probe) => {
    const dump = async (extra) => {
      try {
        const result = await exec(compiler, [...args, ...extra, "-dM", "-E", probe], { cwd, signal, timeout: PROBE_TIMEOUT_MS2 });
        if (result.code !== 0 || result.killed) return { ok: false, reason: firstLines(result.stderr || result.stdout) || `exit ${result.code}` };
        return { ok: true, macros: parseMacros(result.stdout) };
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    };
    const first = await dump([]);
    if (!first.ok) return { ok: false, reason: `${basename2(compiler)} could not run the feature probe: ${first.reason}` };
    const family = familyOf(first.macros);
    const present = presentFeatures(first.macros);
    const needsFlag = {};
    const gated = /* @__PURE__ */ new Map();
    for (const feature of FEATURES) {
      const flag = feature.enable?.[family];
      if (flag && !present.has(feature.id)) gated.set(flag, [...gated.get(flag) ?? [], feature.id]);
    }
    await Promise.all([...gated].map(async ([flag, ids]) => {
      const second = await dump([flag]);
      if (!second.ok) return;
      const withFlag = presentFeatures(second.macros);
      for (const id of ids) if (withFlag.has(id)) needsFlag[id] = flag;
    }));
    return { ok: true, compiler: compilerName(compiler, family, first.macros), family, available: sortFeatures(present), needsFlag };
  });
}
function silencesWarnings(arg) {
  return arg === "-w" || arg === "-Wno-#warnings" || arg === "-Wno-cpp" || arg === "-Wno-everything" || arg === "-pedantic-errors" || /^-Werror(?:=|$)/.test(arg) || /^-Wno-error(?:=|$)/.test(arg) || /^-f(?:error-limit|max-errors)=/.test(arg);
}
async function measureClangd(entry, options = {}, timeoutMs = CLANGD_PROBE_TIMEOUT_MS) {
  const invocation = probeFor(entry);
  if ("reason" in invocation) return { ok: false, reason: invocation.reason };
  return withProbe(probeSource(true), async (dir, probe) => {
    const args = [...invocation.args.filter((arg) => !silencesWarnings(arg)), "-ferror-limit=0"];
    writeFileSync(join2(dir, "compile_commands.json"), JSON.stringify([{ directory: invocation.cwd, file: probe, arguments: [invocation.compiler, ...args, probe] }]));
    const connection = new ClangdConnection(dir, dir, options);
    try {
      const { version } = await connection.syncFile(probe);
      const result = await connection.waitForDiagnostics(probe, version, timeoutMs);
      if (result.status === "pending") return { ok: false, reason: `clangd did not answer the feature probe within ${Math.round(timeoutMs / 1e3)}s` };
      const present = /* @__PURE__ */ new Set();
      let complete = false;
      for (const diagnostic of result.diagnostics) {
        const match = diagnostic.message.match(MARKER_PATTERN);
        if (match?.[1] === PROBE_END) complete = true;
        else if (match && featureById.has(match[1])) present.add(match[1]);
      }
      if (!complete) return { ok: false, reason: "clangd's feature probe was cut short or its warnings were suppressed" };
      return { ok: true, available: sortFeatures(present) };
    } catch (error) {
      return { ok: false, reason: error.message };
    } finally {
      await connection.close().catch(() => {
      });
    }
  });
}
var SETUP_STANDARD = "c++26";
async function setupFeatureLines(exec, options = {}) {
  const cxx = process.env.CXX || "c++";
  const entry = { file: join2(tmpdir(), "pi-cpp-lsp-setup.cpp"), directory: tmpdir(), argv: [cxx, `-std=${SETUP_STANDARD}`] };
  const lines = [];
  const found = (await exec("sh", ["-c", 'command -v "$1"', "sh", cxx], { timeout: 5e3 }).catch(() => void 0))?.code === 0;
  const [compiler, clangd] = await Promise.all([
    found ? measureCompiler(entry, exec) : void 0,
    measureClangd(entry, options.clangd, options.clangdTimeoutMs)
  ]);
  if (!found) lines.push(`\u2717 C++ compiler: ${cxx} was not found on PATH; set CXX to measure another compiler`);
  else if (!compiler.ok) lines.push(`\u2717 C++ compiler: ${cxx} could not be measured: ${oneLine(compiler.reason)}`);
  else lines.push(`\u2713 C++ compiler: ${compiler.compiler} (${compiler.family}), measured with -std=${SETUP_STANDARD}`);
  if (!clangd.ok) lines.push(`\u2717 clangd feature probe: ${oneLine(clangd.reason)}`);
  const ofCompiler = compiler?.ok ? new Set(compiler.available) : void 0;
  const ofClangd = clangd.ok ? new Set(clangd.available) : void 0;
  if (!ofCompiler && !ofClangd) return lines;
  const needsFlag = compiler?.ok ? compiler.needsFlag : {};
  lines.push(`  C++ features with -std=${SETUP_STANDARD}, ${ofCompiler && ofClangd ? "compiler vs clangd" : ofCompiler ? "compiler" : "clangd"}:`);
  for (const standard of STANDARDS) {
    const ids = FEATURES.filter((feature) => feature.standard === standard).map((feature) => feature.id);
    const parts = [];
    if (ofCompiler && ofClangd) {
      const both = ids.filter((id) => ofCompiler.has(id) && ofClangd.has(id));
      if (both.length === ids.length) {
        lines.push(`  C++${standard}: all ${ids.length} in both`);
        continue;
      }
      parts.push(["both", both], ["compiler only", ids.filter((id) => ofCompiler.has(id) && !ofClangd.has(id))], ["clangd only", ids.filter((id) => !ofCompiler.has(id) && ofClangd.has(id))]);
    } else {
      const side = ofCompiler ?? ofClangd;
      parts.push([ofCompiler ? "compiler" : "clangd", ids.filter((id) => side.has(id))]);
    }
    const flags = /* @__PURE__ */ new Map();
    for (const id of ids) if (needsFlag[id]) flags.set(needsFlag[id], [...flags.get(needsFlag[id]) ?? [], id]);
    for (const [flag, flagged] of flags) parts.push([`${ofClangd ? "compiler needs" : "needs"} \`${flag}\``, flagged]);
    const missing = ids.filter((id) => !ofCompiler?.has(id) && !ofClangd?.has(id) && !needsFlag[id]);
    parts.push([ofCompiler && ofClangd ? "neither" : "not supported", missing]);
    lines.push(`  C++${standard}: ${parts.filter(([, list]) => list.length > 0).map(([name, list]) => `${name}: ${featureLabels(list)}`).join("; ")}`);
  }
  return lines;
}

// ../../packages/core/src/setup.ts
var CLANGD_FEATURES = [
  { feature: "incoming calls (cpp_calls)", major: 12 },
  { feature: "type hierarchy (cpp_types)", major: 16 },
  { feature: "outgoing calls (cpp_calls)", major: 21 }
];
function clangdFeatures(versionLine) {
  const match = versionLine.match(/clangd version (\d+)/);
  if (!match) return ["  ? navigation features: could not read the clangd version"];
  const major = Number(match[1]);
  return CLANGD_FEATURES.map(({ feature, major: needed }) => major >= needed ? `  \u2713 ${feature}` : `  \u2717 ${feature.replace(/ \(.*\)$/, "")}: needs clangd ${needed} or newer`);
}
function cmakeFeatures(cmake) {
  return [
    isSupportedCmake(cmake) ? "  \u2713 project model (briefing, drift, managed build)" : "  \u2717 project model: needs CMake 3.14 or newer; CMake projects are treated like non-CMake ones",
    supportsPresets(cmake) ? `  \u2713 presets (${harness.presetCommand})` : "  \u2717 presets: need CMake 3.19 or newer"
  ];
}
var SETUP_TOOLS = [
  { name: "clangd", check: "clangd --version", install: "brew install llvm" },
  { name: "clang-format", check: "clang-format --version", install: "brew install llvm" },
  { name: "clang-tidy", check: "clang-tidy --version", install: "brew install llvm" },
  { name: "cppcheck", check: "cppcheck --version", install: "brew install cppcheck" },
  { name: "cmake", check: "", install: "brew install cmake" },
  { name: "ctest", check: "ctest --version", install: "brew install cmake" },
  { name: "ninja", check: "ninja --version", install: "brew install ninja (optional; the managed build falls back to Unix Makefiles)" }
];
async function setupLines(exec, toolchain) {
  const results = [];
  for (const tool of SETUP_TOOLS) {
    if (tool.name === "cmake") {
      const cmake = await probeCmake(exec);
      if (cmake) results.push(`\u2713 cmake: ${cmake.text}`, ...cmakeFeatures(cmake));
      else results.push(`\u2717 cmake: not found \u2014 install with: ${tool.install}`);
      continue;
    }
    try {
      const r = await exec("sh", ["-c", tool.check], { timeout: 5e3 });
      if (r.code === 0) {
        const version = r.stdout.trim().split("\n")[0];
        results.push(`\u2713 ${tool.name}: ${version}`);
        if (tool.name === "clangd") results.push(...clangdFeatures(version));
      } else {
        results.push(`\u2717 ${tool.name}: not found \u2014 install with: ${tool.install}`);
      }
    } catch {
      results.push(`\u2717 ${tool.name}: not found \u2014 install with: ${tool.install}`);
    }
  }
  results.push(...await setupFeatureLines(exec, toolchain));
  return results;
}

// src/runtime.ts
import { spawn as spawn2 } from "node:child_process";
import { realpathSync as realpathSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var TRUST_COMMAND = "/cpp-lsp:trust";
var UNTRUSTED = {
  reason: "the cpp-lsp plugin is not enabled for it, and configuring it would run the project's CMake code",
  steps: `run ${TRUST_COMMAND}`,
  // Enabling takes effect in the running session, unlike pi's trust, which needs a restart.
  until: "until you enable the plugin here"
};
function usePluginWording() {
  configureHarness({ notePrefix: "cpp-lsp:", presetCommand: "/cpp-lsp:cpp-preset", logName: "cpp-lsp", cacheName: "cpp-lsp-claude" });
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync2(entry) === realpathSync2(fileURLToPath2(moduleUrl));
  } catch {
    return false;
  }
}
var EXIT_STDIO_GRACE_MS = 100;
var nodeExec = (command, args, options = {}) => new Promise((resolve5) => {
  let stdout = "", stderr = "", killed = false;
  let timer;
  let idle;
  let exitCode = null;
  let exited = false, stdoutEnded = false, stderrEnded = false;
  const child = spawn2(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const kill = () => {
    if (killed) return;
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5e3).unref();
  };
  let done = false;
  const finish = (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(idle);
    options.signal?.removeEventListener("abort", kill);
    child.stdout.destroy();
    child.stderr.destroy();
    resolve5({ stdout, stderr, code, killed });
  };
  const exitedCode = () => exitCode ?? 1;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => finish(exitedCode()), EXIT_STDIO_GRACE_MS);
  };
  const finishIfDrained = () => {
    if (exited && stdoutEnded && stderrEnded) finish(exitedCode());
  };
  if (options.signal?.aborted) kill();
  else options.signal?.addEventListener("abort", kill, { once: true });
  if (options.timeout && options.timeout > 0) timer = setTimeout(kill, options.timeout);
  child.stdout.on("data", (data) => {
    stdout += data;
    if (exited) armIdle();
  });
  child.stderr.on("data", (data) => {
    stderr += data;
    if (exited) armIdle();
  });
  child.stdout.once("end", () => {
    stdoutEnded = true;
    finishIfDrained();
  });
  child.stderr.once("end", () => {
    stderrEnded = true;
    finishIfDrained();
  });
  child.on("error", () => finish(127));
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
    finishIfDrained();
    if (!done) armIdle();
  });
  child.once("close", (code) => finish(code ?? 1));
});

// src/bin/setup.ts
async function setupReport(exec, toolchain) {
  usePluginWording();
  return (await setupLines(exec, toolchain)).join("\n");
}
if (isEntry(import.meta.url)) {
  try {
    console.log(await setupReport(nodeExec));
  } catch (error) {
    console.log(`cpp-lsp could not check the toolchain: ${errorMessage(error)}`);
  }
}
export {
  setupReport
};
