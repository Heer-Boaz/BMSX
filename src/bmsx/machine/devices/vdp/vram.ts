import {
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_SURFACE_SYSTEM,
} from './contracts';
import {
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_SYSTEM_SLOT_SIZE,
} from '../../memory/map';
import {
	VRAM_GARBAGE_CHUNK_BYTES,
	VRAM_GARBAGE_SPACE_SALT,
	fillVramGarbageScratch,
	type VramGarbageStream,
} from './vram_garbage';
import {
	createVdpDirtySpans,
	type VdpSurfaceUpload,
	type VdpSurfaceUploadSink,
	type VdpSurfaceUploadSlot,
} from './device_output';

export type VdpFrameBufferSize = {
	width: number;
	height: number;
};

export type VdpEntropySeeds = {
	machineSeed: number;
	bootSeed: number;
};

export type VdpVramSurface = {
	surfaceId: number;
	baseAddr: number;
	capacity: number;
	width: number;
	height: number;
};

export type VdpSurfacePixelsState = {
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	pixels: Uint8Array;
};

export type VdpVramState = {
	staging: Uint8Array;
	surfacePixels: VdpSurfacePixelsState[];
};

type MutableVdpSurfaceUpload = {
	-readonly [Key in keyof VdpSurfaceUpload]: VdpSurfaceUpload[Key];
};

export const DEFAULT_VDP_ENTROPY_SEEDS: VdpEntropySeeds = {
	machineSeed: 0x42564d58,
	bootSeed: 0x7652414d,
};

export function defaultVdpVramSurfaces(frameBufferSize: VdpFrameBufferSize): VdpVramSurface[] {
	return [
		{
			surfaceId: VDP_RD_SURFACE_SYSTEM,
			baseAddr: VRAM_SYSTEM_SLOT_BASE,
			capacity: VRAM_SYSTEM_SLOT_SIZE,
			width: 1,
			height: 1,
		},
		{
			surfaceId: VDP_RD_SURFACE_PRIMARY,
			baseAddr: VRAM_PRIMARY_SLOT_BASE,
			capacity: VRAM_PRIMARY_SLOT_SIZE,
			width: 1,
			height: 1,
		},
		{
			surfaceId: VDP_RD_SURFACE_SECONDARY,
			baseAddr: VRAM_SECONDARY_SLOT_BASE,
			capacity: VRAM_SECONDARY_SLOT_SIZE,
			width: 1,
			height: 1,
		},
		{
			surfaceId: VDP_RD_SURFACE_FRAMEBUFFER,
			baseAddr: VRAM_FRAMEBUFFER_BASE,
			capacity: VRAM_FRAMEBUFFER_SIZE,
			width: frameBufferSize.width,
			height: frameBufferSize.height,
		},
	];
}

export class VdpVramUnit {
	public readonly slots: VdpSurfaceUploadSlot[] = [];
	private readonly staging = new Uint8Array(VRAM_STAGING_SIZE);
	private readonly garbageScratch = new Uint8Array(VRAM_GARBAGE_CHUNK_BYTES);
	private readonly seedPixel = new Uint8Array(4);
	private readonly surfaceUploadOutput: MutableVdpSurfaceUpload = {
		surfaceId: 0,
		surfaceWidth: 0,
		surfaceHeight: 0,
		cpuReadback: new Uint8Array(0),
		dirtyRowStart: 0,
		dirtyRowEnd: 0,
		dirtySpansByRow: [],
		requiresFullSync: false,
	};
	private machineSeed = DEFAULT_VDP_ENTROPY_SEEDS.machineSeed;
	private bootSeed = DEFAULT_VDP_ENTROPY_SEEDS.bootSeed;

	public constructor(entropySeeds: VdpEntropySeeds = DEFAULT_VDP_ENTROPY_SEEDS) {
		this.machineSeed = entropySeeds.machineSeed >>> 0;
		this.bootSeed = entropySeeds.bootSeed >>> 0;
	}

	public initializeSurfaces(surfaces: readonly VdpVramSurface[]): void {
		this.slots.length = 0;
		fillVramGarbageScratch(this.staging, {
			machineSeed: this.machineSeed,
			bootSeed: this.bootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: VRAM_STAGING_BASE >>> 0,
		});
		for (let index = 0; index < surfaces.length; index += 1) {
			this.registerSlot(surfaces[index]!);
		}
	}

	public writeStaging(addr: number, bytes: Uint8Array, srcOffset: number, length: number): boolean {
		if (addr < VRAM_STAGING_BASE || addr + length > VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			return false;
		}
		const offset = addr - VRAM_STAGING_BASE;
		for (let index = 0; index < length; index += 1) {
			this.staging[offset + index] = bytes[srcOffset + index]!;
		}
		return true;
	}

	public readStaging(addr: number, out: Uint8Array): boolean {
		if (addr < VRAM_STAGING_BASE || addr + out.byteLength > VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			return false;
		}
		const offset = addr - VRAM_STAGING_BASE;
		for (let index = 0; index < out.byteLength; index += 1) {
			out[index] = this.staging[offset + index]!;
		}
		return true;
	}

	public writeSurfaceBytes(slot: VdpSurfaceUploadSlot, offset: number, bytes: Uint8Array, srcOffset: number, length: number): void {
		const stride = slot.surfaceWidth * 4;
		let remaining = length;
		let cursor = srcOffset;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			const x = rowOffset / 4;
			this.markSlotDirtySpan(slot, row, x, x + rowBytes / 4);
			this.updateCpuReadback(slot, bytes, cursor, rowBytes, x, row);
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}

	public readSurfaceBytes(slot: VdpSurfaceUploadSlot, offset: number, out: Uint8Array): void {
		const stride = slot.surfaceWidth * 4;
		let remaining = out.byteLength;
		let cursor = 0;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		const buffer = slot.cpuReadback;
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

	public setSlotLogicalDimensions(slot: VdpSurfaceUploadSlot, width: number, height: number): boolean {
		const byteLength = width * height * 4;
		if (width <= 0 || height <= 0 || byteLength > slot.capacity) {
			return false;
		}
		if (slot.surfaceWidth === width && slot.surfaceHeight === height) {
			return true;
		}
		const previous = slot.cpuReadback;
		slot.surfaceWidth = width;
		slot.surfaceHeight = height;
		slot.cpuReadback = new Uint8Array(byteLength);
		slot.dirtySpansByRow = createVdpDirtySpans(height);
		const copyBytes = previous.byteLength < slot.cpuReadback.byteLength ? previous.byteLength : slot.cpuReadback.byteLength;
		if (slot.surfaceId === VDP_RD_SURFACE_SYSTEM) {
			for (let index = 0; index < copyBytes; index += 1) {
				slot.cpuReadback[index] = previous[index]!;
			}
			slot.dirtyRowStart = 0;
			slot.dirtyRowEnd = 0;
			return true;
		}
		this.seedSlotPixels(slot);
		for (let index = 0; index < copyBytes; index += 1) {
			slot.cpuReadback[index] = previous[index]!;
		}
		return true;
	}

	public markSlotDirty(slot: VdpSurfaceUploadSlot, startRow: number, rowCount: number): void {
		const endRow = startRow + rowCount;
		if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
			slot.dirtyRowStart = startRow;
			slot.dirtyRowEnd = endRow;
		} else if (startRow < slot.dirtyRowStart) {
			slot.dirtyRowStart = startRow;
		}
		if (endRow > slot.dirtyRowEnd) {
			slot.dirtyRowEnd = endRow;
		}
		for (let row = startRow; row < endRow; row += 1) {
			const span = slot.dirtySpansByRow[row]!;
			span.xStart = 0;
			span.xEnd = slot.surfaceWidth;
		}
	}

	public findMappedSlot(addr: number, length: number): VdpSurfaceUploadSlot | null {
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			if (addr >= slot.baseAddr && addr + length <= slot.baseAddr + slot.capacity) {
				return slot;
			}
		}
		return null;
	}

	public findSurface(surfaceId: number): VdpSurfaceUploadSlot | null {
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			if (slot.surfaceId === surfaceId) {
				return slot;
			}
		}
		return null;
	}

	public clearSurfaceUploadDirty(surfaceId: number): void {
		const slot = this.findSurface(surfaceId);
		if (slot === null) {
			throw new Error(`[VDP VRAM] upload surface ${surfaceId} has no backing slot.`);
		}
		for (let row = slot.dirtyRowStart; row < slot.dirtyRowEnd; row += 1) {
			const span = slot.dirtySpansByRow[row]!;
			span.xStart = 0;
			span.xEnd = 0;
		}
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
	}

	public drainSurfaceUploads(sink: VdpSurfaceUploadSink): void {
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			if (slot.surfaceId !== VDP_RD_SURFACE_FRAMEBUFFER && slot.dirtyRowStart < slot.dirtyRowEnd) {
				this.emitSurfaceUpload(sink, slot, false);
			}
		}
	}

	public syncSurfaceUploads(sink: VdpSurfaceUploadSink): void {
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			if (slot.surfaceId !== VDP_RD_SURFACE_FRAMEBUFFER) {
				this.emitSurfaceUpload(sink, slot, true);
			}
		}
	}

	public captureState(): VdpVramState {
		return {
			staging: this.staging.slice(),
			surfacePixels: this.captureSurfacePixels(),
		};
	}

	public restoreState(state: VdpVramState): void {
		this.staging.set(state.staging);
		for (let index = 0; index < state.surfacePixels.length; index += 1) {
			this.restoreSurfacePixels(state.surfacePixels[index]!);
		}
	}

	public get trackedUsedBytes(): number {
		let usedBytes = 0;
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			usedBytes += slot.surfaceWidth * slot.surfaceHeight * 4;
		}
		return usedBytes;
	}

	public get trackedTotalBytes(): number {
		return VRAM_SYSTEM_SLOT_SIZE + VRAM_PRIMARY_SLOT_SIZE + VRAM_SECONDARY_SLOT_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
	}

	private registerSlot(surface: VdpVramSurface): void {
		const byteLength = surface.width * surface.height * 4;
		if (surface.width <= 0 || surface.height <= 0 || byteLength > surface.capacity) {
			throw new Error(`[VDP VRAM] invalid surface ${surface.surfaceId} dimensions.`);
		}
		fillVramGarbageScratch(this.seedPixel, {
			machineSeed: this.machineSeed,
			bootSeed: this.bootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: surface.baseAddr >>> 0,
		});
		const slot: VdpSurfaceUploadSlot = {
			baseAddr: surface.baseAddr,
			capacity: surface.capacity,
			surfaceId: surface.surfaceId,
			surfaceWidth: surface.width,
			surfaceHeight: surface.height,
			cpuReadback: new Uint8Array(byteLength),
			dirtyRowStart: 0,
			dirtyRowEnd: 0,
			dirtySpansByRow: createVdpDirtySpans(surface.height),
		};
		this.slots.push(slot);
		if (slot.surfaceId !== VDP_RD_SURFACE_SYSTEM) {
			this.seedSlotPixels(slot);
		}
	}

	private captureSurfacePixels(): VdpSurfacePixelsState[] {
		const surfaces = new Array<VdpSurfacePixelsState>(this.slots.length);
		for (let index = 0; index < this.slots.length; index += 1) {
			const slot = this.slots[index]!;
			surfaces[index] = {
				surfaceId: slot.surfaceId,
				surfaceWidth: slot.surfaceWidth,
				surfaceHeight: slot.surfaceHeight,
				pixels: slot.cpuReadback.slice(),
			};
		}
		return surfaces;
	}

	private restoreSurfacePixels(state: VdpSurfacePixelsState): void {
		const slot = this.findSurface(state.surfaceId);
		if (slot === null) {
			throw new Error(`[VDP VRAM] saved surface ${state.surfaceId} has no backing slot.`);
		}
		if (!this.setSlotLogicalDimensions(slot, state.surfaceWidth, state.surfaceHeight)) {
			throw new Error(`[VDP VRAM] saved surface ${state.surfaceId} has invalid dimensions.`);
		}
		slot.cpuReadback.set(state.pixels);
		this.markSlotDirty(slot, 0, slot.surfaceHeight);
	}

	private emitSurfaceUpload(sink: VdpSurfaceUploadSink, slot: VdpSurfaceUploadSlot, requiresFullSync: boolean): void {
		const upload = this.surfaceUploadOutput;
		upload.surfaceId = slot.surfaceId;
		upload.surfaceWidth = slot.surfaceWidth;
		upload.surfaceHeight = slot.surfaceHeight;
		upload.cpuReadback = slot.cpuReadback;
		upload.dirtyRowStart = slot.dirtyRowStart;
		upload.dirtyRowEnd = slot.dirtyRowEnd;
		upload.dirtySpansByRow = slot.dirtySpansByRow;
		upload.requiresFullSync = requiresFullSync;
		sink.consumeVdpSurfaceUpload(upload);
		this.clearSurfaceUploadDirty(slot.surfaceId);
	}

	private markSlotDirtySpan(slot: VdpSurfaceUploadSlot, row: number, xStart: number, xEnd: number): void {
		const endRow = row + 1;
		if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
			slot.dirtyRowStart = row;
			slot.dirtyRowEnd = endRow;
		} else {
			if (row < slot.dirtyRowStart) {
				slot.dirtyRowStart = row;
			}
			if (endRow > slot.dirtyRowEnd) {
				slot.dirtyRowEnd = endRow;
			}
		}
		const span = slot.dirtySpansByRow[row]!;
		if (span.xStart >= span.xEnd) {
			span.xStart = xStart;
			span.xEnd = xEnd;
			return;
		}
		if (xStart < span.xStart) {
			span.xStart = xStart;
		}
		if (xEnd > span.xEnd) {
			span.xEnd = xEnd;
		}
	}

	private updateCpuReadback(surface: VdpSurfaceUploadSlot, bytes: Uint8Array, srcOffset: number, length: number, x: number, y: number): void {
		const buffer = surface.cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const offset = y * stride + x * 4;
		for (let index = 0; index < length; index += 1) {
			buffer[offset + index] = bytes[srcOffset + index]!;
		}
	}

	private seedSlotPixels(slot: VdpSurfaceUploadSlot): void {
		const width = slot.surfaceWidth;
		const height = slot.surfaceHeight;
		const rowPixels = width;
		const maxPixels = this.garbageScratch.byteLength >>> 2;
		const stream: VramGarbageStream = {
			machineSeed: this.machineSeed,
			bootSeed: this.bootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: slot.baseAddr >>> 0,
		};
		const frameBufferSlot = slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER;
		if (rowPixels <= maxPixels) {
			const rowsPerChunk = (maxPixels / rowPixels) >>> 0;
			for (let y = 0; y < height;) {
				const rowsRemaining = height - y;
				const rows = rowsPerChunk < rowsRemaining ? rowsPerChunk : rowsRemaining;
				const chunkBytes = rowPixels * rows * 4;
				const chunk = this.garbageScratch.subarray(0, chunkBytes);
				fillVramGarbageScratch(chunk, stream);
				if (!frameBufferSlot) {
					this.markSlotDirty(slot, y, rows);
				}
				for (let row = 0; row < rows; row += 1) {
					const rowOffset = row * rowPixels * 4;
					this.updateCpuReadback(slot, chunk, rowOffset, rowPixels * 4, 0, y + row);
				}
				y += rows;
			}
		} else {
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width;) {
					const widthRemaining = width - x;
					const segmentWidth = maxPixels < widthRemaining ? maxPixels : widthRemaining;
					const segmentBytes = segmentWidth * 4;
					const segment = this.garbageScratch.subarray(0, segmentBytes);
					fillVramGarbageScratch(segment, stream);
					if (!frameBufferSlot) {
						this.markSlotDirty(slot, y, 1);
					}
					this.updateCpuReadback(slot, segment, 0, segmentBytes, x, y);
					x += segmentWidth;
				}
			}
		}
	}
}
