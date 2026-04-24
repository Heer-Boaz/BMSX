import type { VDP, VdpSurfaceUploadSlot } from '../../machine/devices/vdp/vdp';
import {
	createVdpTextureFromSeed,
	resizeVdpTextureForKey,
	updateVdpTextureRegion,
} from './texture_transfer';
import { isVdpFrameBufferSurface, resolveVdpRenderSurface } from './surfaces';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);
const syncedTextureSizesByKey = new Map<string, number>();

function packTextureSize(width: number, height: number): number {
	return width * 0x10000 + height;
}

function noteSyncedTextureSize(textureKey: string, width: number, height: number): void {
	syncedTextureSizesByKey.set(textureKey, packTextureSize(width, height));
}

function uploadVdpSlotRows(textureKey: string, slot: VdpSurfaceUploadSlot, rowStart: number, rowEnd: number): void {
	const rowBytes = slot.surfaceWidth * 4;
	updateVdpTextureRegion(
		textureKey,
		slot.cpuReadback.subarray(rowStart * rowBytes, rowEnd * rowBytes),
		slot.surfaceWidth,
		rowEnd - rowStart,
		0,
		rowStart
	);
}

function initializeVdpSlotTexture(vdp: VDP, slot: VdpSurfaceUploadSlot): void {
	const surface = resolveVdpRenderSurface(vdp, slot.surfaceId);
	const textureKey = surface.textureKey;
	const width = slot.surfaceWidth;
	const height = slot.surfaceHeight;
	createVdpTextureFromSeed(textureKey, EMPTY_TEXTURE_SEED, width, height);
	noteSyncedTextureSize(textureKey, width, height);
	uploadVdpSlotRows(textureKey, slot, 0, height);
	vdp.clearSurfaceUploadDirty(slot.surfaceId);
}

export function initializeVdpSlotTextures(vdp: VDP): void {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		initializeVdpSlotTexture(vdp, slot);
	}
}

export function syncVdpSlotTextures(vdp: VDP): void {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		const surface = resolveVdpRenderSurface(vdp, slot.surfaceId);
		const width = slot.surfaceWidth;
		const height = slot.surfaceHeight;
		const textureKey = surface.textureKey;
		const forceFullUpload = syncedTextureSizesByKey.get(textureKey) !== packTextureSize(width, height);
		if (forceFullUpload) {
			resizeVdpTextureForKey(textureKey, width, height);
			noteSyncedTextureSize(textureKey, width, height);
		}
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			continue;
		}
		const rowStart = forceFullUpload ? 0 : slot.dirtyRowStart;
		const rowEnd = forceFullUpload ? slot.surfaceHeight : slot.dirtyRowEnd;
		uploadVdpSlotRows(surface.textureKey, slot, rowStart, rowEnd);
		vdp.clearSurfaceUploadDirty(slot.surfaceId);
	}
}
