import { LUA_BOOT_PRIMITIVES } from '../../machine/firmware/boot_primitives';

export const SYSTEM_ROM_BOOT_HELPER_NAMES = [
	'clock_now',
] as const;

export const SYSTEM_ROM_BOOT_PRIMITIVE_NAMES: ReadonlyArray<string> = LUA_BOOT_PRIMITIVES.map((primitive) => primitive.name);

export const SYSTEM_ROM_BOOT_SYMBOL_NAMES: ReadonlyArray<string> = [
	...SYSTEM_ROM_BOOT_HELPER_NAMES,
	...SYSTEM_ROM_BOOT_PRIMITIVE_NAMES,
];

export const SYSTEM_ROM_BOOT_SYMBOL_NAME_SET: ReadonlySet<string> = new Set(SYSTEM_ROM_BOOT_SYMBOL_NAMES);

export const SYSTEM_ROM_VECTOR_HANDLER_NAME_SET: ReadonlySet<string> = new Set([
	'irq',
	'exception',
]);
