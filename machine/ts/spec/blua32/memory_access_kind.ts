export const enum MemoryAccessKind {
	Word = 0,
	U8 = 1,
	U16LE = 2,
	U32LE = 3,
	F32LE = 4,
	F64LE = 5,
	Value = 6, // Tagged System RAM transfer.
	ContextWord = 7,
}

// A memory Value carries a little-endian payload and a tag byte.
export const VALUE_MEMORY_SIZE = 8;
export const VALUE_MEMORY_TAG_OFFSET = 4;

export type ScalarMemoryAccessKind = Exclude<MemoryAccessKind, MemoryAccessKind.Value | MemoryAccessKind.ContextWord>;

export const MEMORY_ACCESS_KIND_ALIGNMENT_MASKS = [3, 0, 1, 3, 3, 3, 3, 0] as const;
