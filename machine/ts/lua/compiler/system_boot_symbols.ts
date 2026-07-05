export const SYSTEM_ROM_BOOT_HELPER_NAMES = [
	'clock_now',
] as const;

const SYSTEM_ROM_BOOT_LUA_PRIMITIVE_NAMES = [
	'__bmsx_next',
	'__bmsx_type',
	'__bmsx_setmetatable',
	'__bmsx_getmetatable',
	'__bmsx_rawget',
	'__bmsx_rawset',
	'__bmsx_select',
	'__bmsx_string_byte',
	'__bmsx_string_char',
	'__bmsx_error',
	'__bmsx_pcall',
	'__bmsx_xpcall',
] as const;

export const SYSTEM_ROM_BOOT_SYMBOL_NAMES: ReadonlyArray<string> = [
	...SYSTEM_ROM_BOOT_HELPER_NAMES,
	...SYSTEM_ROM_BOOT_LUA_PRIMITIVE_NAMES,
];

export const SYSTEM_ROM_BOOT_SYMBOL_NAME_SET: ReadonlySet<string> = new Set(SYSTEM_ROM_BOOT_SYMBOL_NAMES);
