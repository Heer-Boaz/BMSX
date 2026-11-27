/** Published slots in the system executable's BLua32 function table. */
export const enum BiosFunction {
	TurnPhaseSine = 0,
	DecodeFloat = 1,
	SystemVramRegion = 2,
	CreateTable = 3,
	Concat = 4,
}

export const BIOS_FUNCTION_SLOTS = [
	{ path: 'math/sin', exportPathKey: '' },
	{ path: 'string/float/decode', exportPathKey: '' },
	{ path: 'gpu/system_vram_region', exportPathKey: '' },
	{ path: 'kernel/bios_create_table', exportPathKey: 'create_table', fixedStack: true },
	{ path: 'kernel/bios_concat', exportPathKey: 'intern_concat', fixedStack: true },
] as const;
