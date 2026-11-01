/** Exact written import specifiers map to opaque files under the producer's loader policy. */
export type LuaModuleBindings = ReadonlyMap<string, string>;

/** Files in one program namespace share the same immutable inner map. */
export type LuaProjectModuleBindings = ReadonlyMap<string, LuaModuleBindings>;

/** Link-dependent export paths, keyed by the resolved opaque module address. */
export type LuaModuleLinkExports = ReadonlyMap<string, ReadonlySet<string>>;
