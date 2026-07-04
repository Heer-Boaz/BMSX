import {
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
} from '../../bus/io';
import type { Memory } from '../../memory/memory';
import type { DeviceStatusLatch } from '../device_status';
import {
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_RD_SURFACE_FRAMEBUFFER,
} from './contracts';
import type { VdpSurfaceBacking } from './device_output';

export type VdpReadbackState = {
	readBudgetBytes: number;
	readOverflow: boolean;
};

type VdpReadCache = {
	x0: number;
	y: number;
	width: number;
	data: Uint8Array;
};

const VDP_READBACK_BUDGET_BYTES = 4096;
const VDP_READBACK_MAX_CHUNK_PIXELS = 256;

export class VdpReadbackUnit {
	private readonly frameBufferCache: VdpReadCache = { x0: 0, y: 0, width: 0, data: new Uint8Array(VDP_READBACK_MAX_CHUNK_PIXELS * 4) };
	private readBudgetBytes = VDP_READBACK_BUDGET_BYTES;
	private readOverflow = false;

	public constructor(
		private readonly memory: Memory,
		private readonly fault: DeviceStatusLatch,
	) {
	}

	public invalidateFrameBuffer(): void {
		this.frameBufferCache.width = 0;
	}

	public beginFrame(): void {
		this.readBudgetBytes = VDP_READBACK_BUDGET_BYTES;
		this.readOverflow = false;
	}

	public status(): number {
		let status = 0;
		if (this.readBudgetBytes >= 4) {
			status |= VDP_RD_STATUS_READY;
		}
		if (this.readOverflow) {
			status |= VDP_RD_STATUS_OVERFLOW;
		}
		return status;
	}

	public read(surface: VdpSurfaceBacking, requestedSurfaceId: number, mode: number, x: number, y: number): number {
		if (mode !== VDP_RD_MODE_RGBA8888) {
			this.fault.raise(VDP_FAULT_RD_UNSUPPORTED_MODE, mode);
			return 0;
		}
		if (requestedSurfaceId !== VDP_RD_SURFACE_FRAMEBUFFER) {
			this.fault.raise(VDP_FAULT_RD_SURFACE, requestedSurfaceId);
			return 0;
		}
		const width = surface.surfaceWidth;
		const height = surface.surfaceHeight;
		if (x >= width || y >= height) {
			this.fault.raise(VDP_FAULT_RD_OOB, (x | (y << 16)) >>> 0);
			return 0;
		}
		if (this.readBudgetBytes < 4) {
			this.readOverflow = true;
			return 0;
		}
		const cache = this.getReadCache(surface, x, y);
		const localX = x - cache.x0;
		const byteIndex = localX * 4;
		const r = cache.data[byteIndex]!;
		const g = cache.data[byteIndex + 1]!;
		const b = cache.data[byteIndex + 2]!;
		const a = cache.data[byteIndex + 3]!;
		this.readBudgetBytes -= 4;
		let nextX = x + 1;
		let nextY = y;
		if (nextX >= width) {
			nextX = 0;
			nextY = y + 1;
		}
		this.memory.writeValue(IO_VDP_RD_X, nextX);
		this.memory.writeValue(IO_VDP_RD_Y, nextY);
		return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
	}

	public captureState(): VdpReadbackState {
		return {
			readBudgetBytes: this.readBudgetBytes,
			readOverflow: this.readOverflow,
		};
	}

	public restoreState(state: VdpReadbackState): void {
		this.readBudgetBytes = state.readBudgetBytes;
		this.readOverflow = state.readOverflow;
	}

	private getReadCache(surface: VdpSurfaceBacking, x: number, y: number): VdpReadCache {
		const cache = this.frameBufferCache;
		if (cache.width === 0 || cache.y !== y || x < cache.x0 || x >= cache.x0 + cache.width) {
			this.prefetchReadCache(cache, surface, x, y);
		}
		return cache;
	}

	private prefetchReadCache(cache: VdpReadCache, surface: VdpSurfaceBacking, x: number, y: number): void {
		const maxPixelsByBudget = this.readBudgetBytes >>> 2;
		if (maxPixelsByBudget <= 0) {
			this.readOverflow = true;
			cache.width = 0;
			return;
		}
		const remainingWidth = surface.surfaceWidth - x;
		const chunkLimit = VDP_READBACK_MAX_CHUNK_PIXELS < remainingWidth ? VDP_READBACK_MAX_CHUNK_PIXELS : remainingWidth;
		const chunkW = chunkLimit < maxPixelsByBudget ? chunkLimit : maxPixelsByBudget;
		this.copySurfacePixels(cache, surface, x, y, chunkW, 1);
		cache.x0 = x;
		cache.y = y;
		cache.width = chunkW;
	}

	private copySurfacePixels(cache: VdpReadCache, surface: VdpSurfaceBacking, x: number, y: number, width: number, height: number): void {
		const buffer = surface.cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const rowBytes = width * 4;
		const out = cache.data;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * stride + x * 4;
			const dstOffset = row * rowBytes;
			for (let byte = 0; byte < rowBytes; byte += 1) {
				out[dstOffset + byte] = buffer[srcOffset + byte]!;
			}
		}
	}
}
