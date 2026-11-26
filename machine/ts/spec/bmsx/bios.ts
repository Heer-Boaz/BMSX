/** Published slots in the system executable's BLua32 function table. */
export const enum BiosFunction {
	TurnPhaseSine = 0,
	DecodeFloat = 1,
	SystemVramRegion = 2,
}

/** Guest BIOSCALL selectors; these do not name ordinary BIOS function slots. */
export const enum BiosCall {
	CreateTable = 0,
	Count,
}

export const BIOS_CALL_CONTEXT_WORDS = 3;
export const BIOS_CALL_ARITY = new Uint8Array([2]);

export const BIOS_FUNCTION_MODULE_PATHS = [
	'math/sin',
	'string/float/decode',
	'gpu/system_vram_region',
] as const;
