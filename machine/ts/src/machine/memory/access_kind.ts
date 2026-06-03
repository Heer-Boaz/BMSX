export const enum MemoryAccessKind {
	Word,
	U8,
	U16LE,
	U32LE,
	F32LE,
	F64LE,
}

export const MEMORY_ACCESS_KIND_NAMES = ['mem', 'mem8', 'mem16le', 'mem32le', 'memf32le', 'memf64le'] as const;

export function getMemoryAccessKindForName(name: string): MemoryAccessKind | null {
	switch (name) {
		case 'mem':
			return MemoryAccessKind.Word;
		case 'mem8':
			return MemoryAccessKind.U8;
		case 'mem16le':
			return MemoryAccessKind.U16LE;
		case 'mem32le':
			return MemoryAccessKind.U32LE;
		case 'memf32le':
			return MemoryAccessKind.F32LE;
		case 'memf64le':
			return MemoryAccessKind.F64LE;
		default:
			return null;
	}
}
