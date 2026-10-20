/** Published slots in the system executable's BLua32 function table. */
export const enum BiosFunction {
	TurnPhaseSine = 0,
	DecodeFloat = 1,
	SystemVramRegion = 2,
}

export const BIOS_FUNCTION_MODULE_PATHS = [
	'math/sin',
	'string/float/decode',
	'gpu/system_vram_region',
] as const;
