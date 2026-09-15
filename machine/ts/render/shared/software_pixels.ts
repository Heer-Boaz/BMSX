/** Opaque nearest sampling at pixel centres. Clipping never changes the source mapping. */
export function blitOpaquePixels(source: Uint8Array, sourceWidth: number, sourceHeight: number,
	target: Uint8Array, targetStride: number, left: number, top: number, right: number, bottom: number,
	clipLeft: number, clipTop: number, clipRight: number, clipBottom: number): void {
	const startX = Math.max(left, clipLeft), startY = Math.max(top, clipTop);
	const endX = Math.min(right, clipRight), endY = Math.min(bottom, clipBottom);
	if (startX >= endX || startY >= endY) return;
	const sourceStepX = Math.trunc(sourceWidth * 0x10000 / (right - left));
	const sourceStepY = Math.trunc(sourceHeight * 0x10000 / (bottom - top));
	let sourceY = (sourceStepY >>> 1) + (startY - top) * sourceStepY;
	for (let y = startY; y < endY; y += 1) {
		const sourceRow = (sourceY >>> 16) * sourceWidth;
		let offset = (y * targetStride + startX) * 4;
		let sourceX = (sourceStepX >>> 1) + (startX - left) * sourceStepX;
		for (let x = startX; x < endX; x += 1) {
			const from = (sourceRow + (sourceX >>> 16)) * 4;
			target[offset] = source[from]; target[offset + 1] = source[from + 1]; target[offset + 2] = source[from + 2]; target[offset + 3] = 255;
			offset += 4;
			sourceX += sourceStepX;
		}
		sourceY += sourceStepY;
	}
}
