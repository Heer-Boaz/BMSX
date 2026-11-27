/** Published slots in the system executable's BLua32 function table. */
export const enum BiosFunction {
	TurnPhaseSine = 0,
	DecodeFloat = 1,
	SystemVramRegion = 2,
}

export const BIOS_FUNCTION_SLOTS = [
	{ path: 'math/sin', exportPathKey: '' },
	{ path: 'string/float/decode', exportPathKey: '' },
	{ path: 'gpu/system_vram_region', exportPathKey: '' },
] as const;
