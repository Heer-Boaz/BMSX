import {
	VDP_RD_SURFACE_FRAMEBUFFER,
} from './contracts';
import {
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_TEXTURE_SIZE,
} from '../../memory/map';
import {
	VRAM_GARBAGE_CHUNK_BYTES,
	VRAM_GARBAGE_SPACE_SALT,
	fillVramGarbageScratch,
	type VramGarbageStream,
} from './vram_garbage';
import type { VdpSurfaceBacking } from './device_output';
import {
	VDP_RPU_PARAM_MEM_PAGE_COUNT,
	bumpVdpRpuVramPageRevisions
} from './rpu';

export type VdpFrameBufferSize = {
	width: number;
	height: number;
};

export type VdpEntropySeeds = {
	machineSeed: number;
	bootSeed: number;
};

export type VdpSurfacePixelsState = {
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	pixels: Uint8Array;
};

export type VdpVramState = {
	rpuVram: Uint8Array;
	surfacePixels: VdpSurfacePixelsState[];
};

function vramSurfaceByteSize(width: number, height: number): number {
	return (width * height * 4) >>> 0;
}

export const DEFAULT_VDP_ENTROPY_SEEDS: VdpEntropySeeds = {
	machineSeed: 0x42564d58,
	bootSeed: 0x7652414d,
};

export class VdpVramUnit {
	private readonly frameBuffer: VdpSurfaceBacking;
	public readonly rpuVram: Uint8Array = new Uint8Array(VRAM_STAGING_SIZE + VRAM_TEXTURE_SIZE);
	public readonly rpuVramPageRevisions: Uint32Array = new Uint32Array(VDP_RPU_PARAM_MEM_PAGE_COUNT);
	private readonly garbageScratch = new Uint8Array(VRAM_GARBAGE_CHUNK_BYTES);
	private machineSeed = DEFAULT_VDP_ENTROPY_SEEDS.machineSeed;
	private bootSeed = DEFAULT_VDP_ENTROPY_SEEDS.bootSeed;

	public constructor(
		private readonly frameBufferSize: VdpFrameBufferSize,
		entropySeeds: VdpEntropySeeds = DEFAULT_VDP_ENTROPY_SEEDS,
	) {
		this.machineSeed = entropySeeds.machineSeed >>> 0;
		this.bootSeed = entropySeeds.bootSeed >>> 0;
		this.frameBuffer = {
			baseAddr: VRAM_FRAMEBUFFER_BASE,
			capacity: VRAM_FRAMEBUFFER_SIZE,
			surfaceId: VDP_RD_SURFACE_FRAMEBUFFER,
			surfaceWidth: frameBufferSize.width,
			surfaceHeight: frameBufferSize.height,
			cpuReadback: new Uint8Array(vramSurfaceByteSize(frameBufferSize.width, frameBufferSize.height)),
		};
		this.seedSurfacePixels(this.frameBuffer);
	}


	public get frameBufferSurface(): VdpSurfaceBacking {
		return this.frameBuffer;
	}

	public initializeFrameBuffer(): void {
		fillVramGarbageScratch(this.rpuVram, this.rpuVram.byteLength, {
			machineSeed: this.machineSeed,
			bootSeed: this.bootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: VRAM_STAGING_BASE >>> 0,
		});
		bumpVdpRpuVramPageRevisions(this.rpuVramPageRevisions, 0, this.rpuVram.byteLength);
		this.configureFrameBufferSurface(this.frameBufferSize.width, this.frameBufferSize.height);
	}

	public writeRpuVram(addr: number, bytes: Uint8Array, srcOffset: number, length: number): boolean {
		if (addr < VRAM_STAGING_BASE) {
			return false;
		}
		const offset = addr - VRAM_STAGING_BASE;
		if (offset > this.rpuVram.byteLength || length > this.rpuVram.byteLength - offset) {
			return false;
		}
		for (let index = 0; index < length; index += 1) {
			this.rpuVram[offset + index] = bytes[srcOffset + index]!;
		}
		bumpVdpRpuVramPageRevisions(this.rpuVramPageRevisions, offset, length);
		return true;
	}

	public readRpuVram(addr: number, out: Uint8Array, length: number): boolean {
		if (addr < VRAM_STAGING_BASE) {
			return false;
		}
		const offset = addr - VRAM_STAGING_BASE;
		if (offset > this.rpuVram.byteLength || length > this.rpuVram.byteLength - offset) {
			return false;
		}
		for (let index = 0; index < length; index += 1) {
			out[index] = this.rpuVram[offset + index]!;
		}
		return true;
	}

	public writeSurfaceBytes(surface: VdpSurfaceBacking, offset: number, bytes: Uint8Array, srcOffset: number, length: number): void {
		const stride = surface.surfaceWidth * 4;
		let remaining = length;
		let cursor = srcOffset;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			this.updateCpuReadback(surface, bytes, cursor, rowBytes, rowOffset / 4, row);
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}

	public readSurfaceBytes(surface: VdpSurfaceBacking, offset: number, out: Uint8Array, length: number): void {
		const stride = surface.surfaceWidth * 4;
		let remaining = length;
		let cursor = 0;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		const buffer = surface.cpuReadback;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			const srcOffset = row * stride + rowOffset;
			for (let index = 0; index < rowBytes; index += 1) {
				out[cursor + index] = buffer[srcOffset + index]!;
			}
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}

	public setSurfaceLogicalDimensions(surface: VdpSurfaceBacking, width: number, height: number): void {
		const byteLength = vramSurfaceByteSize(width, height);
		if (surface.surfaceWidth === width && surface.surfaceHeight === height) {
			return;
		}
		const previous = surface.cpuReadback;
		surface.surfaceWidth = width;
		surface.surfaceHeight = height;
		surface.cpuReadback = new Uint8Array(byteLength);
		const copyBytes = previous.byteLength < surface.cpuReadback.byteLength ? previous.byteLength : surface.cpuReadback.byteLength;
		this.seedSurfacePixels(surface);
		for (let index = 0; index < copyBytes; index += 1) {
			surface.cpuReadback[index] = previous[index]!;
		}
	}

	public frameBufferContains(addr: number, length: number): boolean {
		const surface = this.frameBuffer;
		return addr >= surface.baseAddr && addr + length <= surface.baseAddr + surface.capacity;
	}

	public captureState(): VdpVramState {
		const rpuVram = new Uint8Array(this.rpuVram.byteLength);
		for (let index = 0; index < this.rpuVram.byteLength; index += 1) {
			rpuVram[index] = this.rpuVram[index]!;
		}
		return {
			rpuVram,
			surfacePixels: this.captureSurfacePixels(),
		};
	}

	public restoreState(state: VdpVramState): void {
		for (let index = 0; index < state.rpuVram.byteLength; index += 1) {
			this.rpuVram[index] = state.rpuVram[index]!;
		}
		bumpVdpRpuVramPageRevisions(this.rpuVramPageRevisions, 0, state.rpuVram.byteLength);
		for (let index = 0; index < state.surfacePixels.length; index += 1) {
			this.restoreSurfacePixels(state.surfacePixels[index]!);
		}
	}

	public get trackedUsedBytes(): number {
		return this.rpuVram.byteLength + vramSurfaceByteSize(this.frameBuffer.surfaceWidth, this.frameBuffer.surfaceHeight);
	}

	public get trackedTotalBytes(): number {
		return VRAM_STAGING_SIZE + VRAM_TEXTURE_SIZE + VRAM_FRAMEBUFFER_SIZE;
	}

	private configureFrameBufferSurface(width: number, height: number): void {
		const byteLength = vramSurfaceByteSize(width, height);
		const surface = this.frameBuffer;
		surface.baseAddr = VRAM_FRAMEBUFFER_BASE;
		surface.capacity = VRAM_FRAMEBUFFER_SIZE;
		surface.surfaceId = VDP_RD_SURFACE_FRAMEBUFFER;
		surface.surfaceWidth = width;
		surface.surfaceHeight = height;
		surface.cpuReadback = new Uint8Array(byteLength);
		this.seedSurfacePixels(surface);
	}

	private captureSurfacePixels(): VdpSurfacePixelsState[] {
		const surface = this.frameBuffer;
		const pixels = new Uint8Array(surface.cpuReadback.byteLength);
		for (let byteIndex = 0; byteIndex < surface.cpuReadback.byteLength; byteIndex += 1) {
			pixels[byteIndex] = surface.cpuReadback[byteIndex]!;
		}
		return [{
			surfaceId: surface.surfaceId,
			surfaceWidth: surface.surfaceWidth,
			surfaceHeight: surface.surfaceHeight,
			pixels,
		}];
	}

	private restoreSurfacePixels(state: VdpSurfacePixelsState): void {
		const surface = this.frameBuffer;
		for (let index = 0; index < state.pixels.byteLength; index += 1) {
			surface.cpuReadback[index] = state.pixels[index]!;
		}
	}

	private updateCpuReadback(surface: VdpSurfaceBacking, bytes: Uint8Array, srcOffset: number, length: number, x: number, y: number): void {
		const buffer = surface.cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const offset = y * stride + x * 4;
		for (let index = 0; index < length; index += 1) {
			buffer[offset + index] = bytes[srcOffset + index]!;
		}
	}

	private seedSurfacePixels(surface: VdpSurfaceBacking): void {
		const width = surface.surfaceWidth;
		const height = surface.surfaceHeight;
		const rowPixels = width;
		const maxPixels = this.garbageScratch.byteLength >>> 2;
		const stream: VramGarbageStream = {
			machineSeed: this.machineSeed,
			bootSeed: this.bootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: surface.baseAddr >>> 0,
		};
		if (rowPixels <= maxPixels) {
			const rowsPerChunk = (maxPixels / rowPixels) >>> 0;
			for (let y = 0; y < height;) {
				const rowsRemaining = height - y;
				const rows = rowsPerChunk < rowsRemaining ? rowsPerChunk : rowsRemaining;
				const chunkBytes = rowPixels * rows * 4;
				fillVramGarbageScratch(this.garbageScratch, chunkBytes, stream);
				for (let row = 0; row < rows; row += 1) {
					const rowOffset = row * rowPixels * 4;
					this.updateCpuReadback(surface, this.garbageScratch, rowOffset, rowPixels * 4, 0, y + row);
				}
				y += rows;
			}
		} else {
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width;) {
					const widthRemaining = width - x;
					const segmentWidth = maxPixels < widthRemaining ? maxPixels : widthRemaining;
					const segmentBytes = segmentWidth * 4;
					fillVramGarbageScratch(this.garbageScratch, segmentBytes, stream);
					this.updateCpuReadback(surface, this.garbageScratch, 0, segmentBytes, x, y);
					x += segmentWidth;
				}
			}
		}
	}
}
