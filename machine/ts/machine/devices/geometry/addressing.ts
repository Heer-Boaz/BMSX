export function geometryByteAddr(base: number, offset: number): number {
	return (base + offset) >>> 0;
}

export function geometryIndexedAddr(base: number, index: number, stride: number): number {
	return geometryByteAddr(base, Math.imul(index, stride));
}
