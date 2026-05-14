import type { VDP } from '../../machine/devices/vdp/vdp';
import type { VdpSurfaceUpload, VdpSurfaceUploadSink } from '../../machine/devices/vdp/device_output';
import { VDP_RD_SURFACE_COUNT } from '../../machine/devices/vdp/contracts';
import { DEFAULT_TEXTURE_PARAMS } from '../backend/texture_params';
import type { TextureManager } from '../texture_manager';
import type { GameView } from '../gameview';
import { resolveVdpRenderSurfaceForUpload } from './surfaces';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);

export type VdpSlotTexturePixels = {
	pixels: Uint8Array;
	width: number;
	height: number;
	stride: number;
};

export class VdpSlotTextures implements VdpSurfaceUploadSink {
	private readonly syncedTextureWidths = new Uint32Array(VDP_RD_SURFACE_COUNT);
	private readonly syncedTextureHeights = new Uint32Array(VDP_RD_SURFACE_COUNT);
	private readonly surfaceReadbacks = new Array<VdpSlotTexturePixels>(VDP_RD_SURFACE_COUNT);

	public constructor(
		private readonly textureManager: TextureManager,
		private readonly view: GameView,
	) {
	}

	public initialize(vdp: VDP): void {
		this.syncedTextureWidths.fill(0);
		this.syncedTextureHeights.fill(0);
		this.surfaceReadbacks.length = 0;
		this.surfaceReadbacks.length = VDP_RD_SURFACE_COUNT;
		vdp.syncSurfaceUploads(this);
	}

	public consumeVdpSurfaceUpload(slot: VdpSurfaceUpload): void {
		if (slot.requiresFullSync) {
			this.initializeVdpSlotTexture(slot);
			return;
		}
		const surface = resolveVdpRenderSurfaceForUpload(slot);
		const width = slot.surfaceWidth;
		const height = slot.surfaceHeight;
		const textureKey = surface.textureKey;
		const forceFullUpload = !this.isSyncedTextureSize(slot.surfaceId, width, height);
		if (forceFullUpload) {
			const handle = this.textureManager.resizeTextureForKey(textureKey, width, height);
			this.view.textures[textureKey] = handle;
			this.noteSyncedTextureSize(slot.surfaceId, width, height);
		}
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			return;
		}
		if (forceFullUpload) {
			this.uploadVdpSlotRows(textureKey, slot, 0, height);
		} else {
			for (let row = slot.dirtyRowStart; row < slot.dirtyRowEnd; row += 1) {
				const span = slot.dirtySpansByRow[row]!;
				if (span.xStart < span.xEnd) {
					this.uploadVdpSlotSpan(textureKey, slot, row, span.xStart, span.xEnd);
				}
			}
		}
	}

	public readSurfaceTexturePixels(surfaceId: number): VdpSlotTexturePixels {
		const pixels = this.surfaceReadbacks[surfaceId];
		if (pixels === undefined) {
			throw new Error(`[VDPSlotTextures] Surface ${surfaceId} has no synced texture pixels.`);
		}
		return pixels;
	}

	private isSyncedTextureSize(surfaceId: number, width: number, height: number): boolean {
		return this.syncedTextureWidths[surfaceId] === width && this.syncedTextureHeights[surfaceId] === height;
	}

	private noteSyncedTextureSize(surfaceId: number, width: number, height: number): void {
		this.syncedTextureWidths[surfaceId] = width;
		this.syncedTextureHeights[surfaceId] = height;
	}

	private noteSlotTexturePixels(slot: VdpSurfaceUpload): void {
		let pixels = this.surfaceReadbacks[slot.surfaceId];
		if (pixels === undefined) {
			pixels = {
				pixels: slot.cpuReadback,
				width: slot.surfaceWidth,
				height: slot.surfaceHeight,
				stride: slot.surfaceWidth * 4,
			};
			this.surfaceReadbacks[slot.surfaceId] = pixels;
			return;
		}
		pixels.pixels = slot.cpuReadback;
		pixels.width = slot.surfaceWidth;
		pixels.height = slot.surfaceHeight;
		pixels.stride = slot.surfaceWidth * 4;
	}

	private uploadVdpSlotRows(textureKey: string, slot: VdpSurfaceUpload, rowStart: number, rowEnd: number): void {
		const rowBytes = slot.surfaceWidth * 4;
		const byteOffset = rowStart * rowBytes;
		this.noteSlotTexturePixels(slot);
		this.view.backend.updateTextureRegion(
			this.textureManager.getTextureByUri(textureKey),
			slot.cpuReadback,
			slot.surfaceWidth,
			rowEnd - rowStart,
			0,
			rowStart,
			DEFAULT_TEXTURE_PARAMS,
			byteOffset
		);
	}

	private uploadVdpSlotSpan(textureKey: string, slot: VdpSurfaceUpload, row: number, xStart: number, xEnd: number): void {
		const rowBytes = slot.surfaceWidth * 4;
		const byteOffset = row * rowBytes + xStart * 4;
		this.noteSlotTexturePixels(slot);
		this.view.backend.updateTextureRegion(
			this.textureManager.getTextureByUri(textureKey),
			slot.cpuReadback,
			xEnd - xStart,
			1,
			xStart,
			row,
			DEFAULT_TEXTURE_PARAMS,
			byteOffset
		);
	}

	private initializeVdpSlotTexture(slot: VdpSurfaceUpload): void {
		const surface = resolveVdpRenderSurfaceForUpload(slot);
		const textureKey = surface.textureKey;
		const width = slot.surfaceWidth;
		const height = slot.surfaceHeight;
		this.textureManager.createTextureFromPixelsSync(textureKey, EMPTY_TEXTURE_SEED, 1, 1);
		const handle = this.textureManager.resizeTextureForKey(textureKey, width, height);
		this.view.textures[textureKey] = handle;
		this.noteSyncedTextureSize(slot.surfaceId, width, height);
		this.uploadVdpSlotRows(textureKey, slot, 0, height);
	}
}
