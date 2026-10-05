import { LUA_BOOT_PRIMITIVES } from '../../../../machine/ts/spec/blua32/builtin';

export type ProgramCompileDomain = 'cart' | 'system';

export const SYSTEM_ROM_BOOT_PRIMITIVE_NAMES: ReadonlyArray<string> = LUA_BOOT_PRIMITIVES.map(primitive => primitive.name);

/** Ambient names supplied by the machine at system initialization, not cart globals. */
export const PROGRAM_BOOT_GLOBAL_NAMES: Readonly<Record<ProgramCompileDomain, readonly string[]>> = {
	system: SYSTEM_ROM_BOOT_PRIMITIVE_NAMES,
	cart: [],
};

export const SYSTEM_ROM_VECTOR_HANDLER_NAME_SET: ReadonlySet<string> = new Set([
	'irq',
	'exception',
]);
