export const GEOMETRY_WORD_ALIGN_MASK = 3;

export function geometryByteAddr(base: number, offset: number): number {
	return (base + offset) >>> 0;
}

export function geometryIndexedAddr(base: number, index: number, stride: number): number {
	return geometryByteAddr(base, Math.imul(index, stride));
}

export function geometryByteSpanFits(base: number, offset: number, byteLength: number): boolean {
	const addr = base + offset;
	return addr <= 0xffff_ffff && addr + byteLength <= 0x1_0000_0000;
}

export function geometryIndexedSpanFits(base: number, index: number, stride: number, byteLength: number): boolean {
	return (stride === 0 || index <= 0xffff_ffff / stride)
		&& geometryByteSpanFits(base, index * stride, byteLength);
}
