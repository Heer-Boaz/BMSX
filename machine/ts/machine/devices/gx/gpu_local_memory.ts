import { GX_GPU_VRAM_BYTE_COUNT, GX_GPU_VRAM_WORD_COUNT } from './vram_address';

export const GX_GPU_PSMCT32 = 0;
export const GX_GPU_PSMCT24 = 1;
export const GX_GPU_PSMCT16 = 2;
export const GX_GPU_PSMCT16S = 10;
export const GX_GPU_PSGPU24 = 18;
export const GX_GPU_PSMGX16 = 31;

const GX_GPU_VRAM_WORD_MASK = GX_GPU_VRAM_WORD_COUNT - 1;
const GX_GPU_VRAM_BYTE_MASK = GX_GPU_VRAM_BYTE_COUNT - 1;

export function gxGpuLocalMemoryAddress32(
	baseWord: number,
	pagesPerRow: number,
	x: number,
	y: number,
): number {
	const page = (y >>> 5) * pagesPerRow + (x >>> 6);
	const pageX = x & 63;
	const pageY = y & 31;
	const blockX = pageX >>> 3;
	const blockY = pageY >>> 3;
	const block = (blockX & 1)
		| ((blockY & 1) << 1)
		| ((blockX & 2) << 1)
		| ((blockY & 2) << 2)
		| ((blockX & 4) << 2);
	const column = (pageX & 1)
		| ((pageY & 1) << 1)
		| ((pageX & 6) << 1)
		| ((pageY & 6) << 3);
	return (baseWord + (page << 12) + (block << 7) + (column << 1)) & GX_GPU_VRAM_WORD_MASK;
}

function gxGpuLocalMemoryColumn16(pageX: number, pageY: number): number {
	return ((pageX & 1) << 1)
		| ((pageX & 2) << 2)
		| ((pageX & 4) << 2)
		| ((pageX & 8) >>> 3)
		| ((pageY & 1) << 2)
		| ((pageY & 2) << 4)
		| ((pageY & 4) << 4);
}

export function gxGpuLocalMemoryAddress16(
	baseWord: number,
	pagesPerRow: number,
	x: number,
	y: number,
): number {
	const page = (y >>> 6) * pagesPerRow + (x >>> 6);
	const pageX = x & 63;
	const pageY = y & 63;
	const blockX = pageX >>> 4;
	const blockY = pageY >>> 3;
	const block = ((blockX & 1) << 1)
		| (blockY & 1)
		| ((blockX & 2) << 2)
		| ((blockY & 2) << 1)
		| ((blockY & 4) << 2);
	return (baseWord + (page << 12) + (block << 7) + gxGpuLocalMemoryColumn16(pageX, pageY)) & GX_GPU_VRAM_WORD_MASK;
}

export function gxGpuLocalMemoryAddress16S(
	baseWord: number,
	pagesPerRow: number,
	x: number,
	y: number,
): number {
	const page = (y >>> 6) * pagesPerRow + (x >>> 6);
	const pageX = x & 63;
	const pageY = y & 63;
	const blockX = pageX >>> 4;
	const blockY = pageY >>> 3;
	const block = (blockY & 1)
		| ((blockX & 1) << 1)
		| (blockY & 4)
		| ((blockY & 2) << 2)
		| ((blockX & 2) << 3);
	return (baseWord + (page << 12) + (block << 7) + gxGpuLocalMemoryColumn16(pageX, pageY)) & GX_GPU_VRAM_WORD_MASK;
}

export function gxGpuLocalMemoryAddressGx16(
	baseWord: number,
	framebufferWidth: number,
	x: number,
	y: number,
): number {
	return (baseWord + y * framebufferWidth + x) & GX_GPU_VRAM_WORD_MASK;
}

export function gxGpuLocalMemoryByteAddressGpu24(
	baseWord: number,
	pagesPerRow: number,
	pixelX: number,
	y: number,
	channel: number,
): number {
	const logicalByte = pixelX * 3 + channel;
	const wordAddress = gxGpuLocalMemoryAddress16(baseWord, pagesPerRow, logicalByte >>> 1, y);
	return ((wordAddress << 1) | (logicalByte & 1)) & GX_GPU_VRAM_BYTE_MASK;
}
