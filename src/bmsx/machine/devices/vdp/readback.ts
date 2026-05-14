import {
	VDP_FAULT_NONE,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_RD_SURFACE_COUNT,
} from './contracts';
import type { VdpSurfaceUploadSlot } from './device_output';

export type VdpReadbackState = {
	readBudgetBytes: number;
	readOverflow: boolean;
};

type VdpReadSurface = {
	surfaceId: number;
	registered: boolean;
};

type VdpReadCache = {
	x0: number;
	y: number;
	width: number;
	data: Uint8Array;
};

const VDP_READBACK_BUDGET_BYTES = 4096;
const VDP_READBACK_MAX_CHUNK_PIXELS = 256;

function createReadSurfaceEntries(): VdpReadSurface[] {
	const entries: VdpReadSurface[] = [];
	for (let surfaceId = 0; surfaceId < VDP_RD_SURFACE_COUNT; surfaceId += 1) {
		entries.push({ surfaceId, registered: false });
	}
	return entries;
}

function createReadCaches(): VdpReadCache[] {
	const entries: VdpReadCache[] = [];
	for (let surfaceId = 0; surfaceId < VDP_RD_SURFACE_COUNT; surfaceId += 1) {
		entries.push({ x0: 0, y: 0, width: 0, data: new Uint8Array(VDP_READBACK_MAX_CHUNK_PIXELS * 4) });
	}
	return entries;
}

export class VdpReadbackUnit {
	public resolvedSurfaceId = 0;
	public faultCode = VDP_FAULT_NONE;
	public faultDetail = 0;
	public word = 0;
	public nextX = 0;
	public nextY = 0;
	public advanceReadPosition = false;
	private readonly readSurfaces = createReadSurfaceEntries();
	private readonly readCaches = createReadCaches();
	private readBudgetBytes = VDP_READBACK_BUDGET_BYTES;
	private readOverflow = false;

	public resetSurfaceRegistry(): void {
		for (let surfaceId = 0; surfaceId < VDP_RD_SURFACE_COUNT; surfaceId += 1) {
			const readSurface = this.readSurfaces[surfaceId]!;
			readSurface.surfaceId = surfaceId;
			readSurface.registered = false;
			this.invalidateSurface(surfaceId);
		}
	}

	public registerSurface(surfaceId: number): void {
		const readSurface = this.readSurfaces[surfaceId]!;
		readSurface.surfaceId = surfaceId;
		readSurface.registered = true;
		this.invalidateSurface(surfaceId);
	}

	public invalidateSurface(surfaceId: number): void {
		this.readCaches[surfaceId]!.width = 0;
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

	public resolveSurface(requestedSurfaceId: number, mode: number): boolean {
		this.faultCode = VDP_FAULT_NONE;
		this.faultDetail = 0;
		this.advanceReadPosition = false;
		this.word = 0;
		if (mode !== VDP_RD_MODE_RGBA8888) {
			this.faultCode = VDP_FAULT_RD_UNSUPPORTED_MODE;
			this.faultDetail = mode;
			return false;
		}
		if (requestedSurfaceId >= VDP_RD_SURFACE_COUNT) {
			this.faultCode = VDP_FAULT_RD_SURFACE;
			this.faultDetail = requestedSurfaceId;
			return false;
		}
		const readSurface = this.readSurfaces[requestedSurfaceId]!;
		if (!readSurface.registered) {
			this.faultCode = VDP_FAULT_RD_SURFACE;
			this.faultDetail = requestedSurfaceId;
			return false;
		}
		this.resolvedSurfaceId = readSurface.surfaceId;
		return true;
	}

	public readPixel(surface: VdpSurfaceUploadSlot, x: number, y: number): boolean {
		const width = surface.surfaceWidth;
		const height = surface.surfaceHeight;
		if (x >= width || y >= height) {
			this.faultCode = VDP_FAULT_RD_OOB;
			this.faultDetail = (x | (y << 16)) >>> 0;
			this.word = 0;
			return false;
		}
		if (this.readBudgetBytes < 4) {
			this.readOverflow = true;
			this.word = 0;
			this.advanceReadPosition = false;
			return true;
		}
		const cache = this.getReadCache(this.resolvedSurfaceId, surface, x, y);
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
		this.nextX = nextX;
		this.nextY = nextY;
		this.advanceReadPosition = true;
		this.word = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
		return true;
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

	private getReadCache(surfaceId: number, surface: VdpSurfaceUploadSlot, x: number, y: number): VdpReadCache {
		const cache = this.readCaches[surfaceId]!;
		if (cache.width === 0 || cache.y !== y || x < cache.x0 || x >= cache.x0 + cache.width) {
			this.prefetchReadCache(cache, surface, x, y);
		}
		return cache;
	}

	private prefetchReadCache(cache: VdpReadCache, surface: VdpSurfaceUploadSlot, x: number, y: number): void {
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

	private copySurfacePixels(cache: VdpReadCache, surface: VdpSurfaceUploadSlot, x: number, y: number, width: number, height: number): void {
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
