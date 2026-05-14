export const GEOMETRY_WORD_ALIGN_MASK = 3;
export const GEOMETRY_VERTEX2_U32_SPAN_MAX_COUNT = 0x1fff_ffff;

export function resolveGeometryByteOffset(base: number, offset: number, byteLength: number): number | null {
	if (offset > 0xffff_ffff || byteLength > 0x1_0000_0000) {
		return null;
	}
	const addr = base + offset;
	if (addr > 0xffff_ffff) {
		return null;
	}
	const end = addr + byteLength;
	if (end > 0x1_0000_0000) {
		return null;
	}
	return addr >>> 0;
}

export function resolveGeometryIndexedSpan(base: number, index: number, stride: number, byteLength: number): number | null {
	if (stride !== 0 && index > 0xffff_ffff / stride) {
		return null;
	}
	return resolveGeometryByteOffset(base, index * stride, byteLength);
}
