export const enum MemoryAccessKind {
	Word = 0,
	U8 = 1,
	U16LE = 2,
	U32LE = 3,
	F32LE = 4,
	F64LE = 5,
}

export const MEMORY_ACCESS_KIND_ALIGNMENT_MASKS = [3, 0, 1, 3, 3, 3] as const;
