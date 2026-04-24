import type { VDP, VdpSurfaceUploadSlot } from '../../machine/devices/vdp/vdp';
import {
	ensureVdpTextureFromSeed,
	resizeVdpTextureForKey,
	updateVdpTextureRegion,
} from './texture_transfer';
import { getVdpRenderSurfaceTexture, isVdpFrameBufferSurface, resolveVdpRenderSurface } from './surfaces';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);
const syncedTextureSizesByKey = new Map<string, number>();

function packTextureSize(width: number, height: number): number {
	return width * 0x10000 + height;
}

function ensureVdpSlotTexture(vdp: VDP, slot: VdpSurfaceUploadSlot): boolean {
	const surface = resolveVdpRenderSurface(vdp, slot.surfaceId);
	const textureKey = surface.textureKey;
	const width = slot.surfaceWidth;
	const height = slot.surfaceHeight;
	const packedSize = packTextureSize(width, height);
	const syncedSize = syncedTextureSizesByKey.get(textureKey);
	const handle = getVdpRenderSurfaceTexture(vdp, slot.surfaceId);
	if (!handle) {
		ensureVdpTextureFromSeed(textureKey, EMPTY_TEXTURE_SEED, width, height);
		syncedTextureSizesByKey.set(textureKey, packedSize);
		return true;
	}
	if (syncedSize === packedSize) {
		return false;
	}
	resizeVdpTextureForKey(textureKey, width, height);
	syncedTextureSizesByKey.set(textureKey, packedSize);
	return true;
}

export function syncVdpSlotTextures(vdp: VDP): void {
	const slots = vdp.surfaceUploadSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (isVdpFrameBufferSurface(slot.surfaceId)) {
			continue;
		}
		const surface = resolveVdpRenderSurface(vdp, slot.surfaceId);
		const forceFullUpload = ensureVdpSlotTexture(vdp, slot);
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			continue;
		}
		const rowStart = forceFullUpload ? 0 : slot.dirtyRowStart;
		const rowEnd = forceFullUpload ? slot.surfaceHeight : slot.dirtyRowEnd;
		const rowBytes = slot.surfaceWidth * 4;
		updateVdpTextureRegion(
			surface.textureKey,
			slot.cpuReadback.subarray(rowStart * rowBytes, rowEnd * rowBytes),
			slot.surfaceWidth,
			rowEnd - rowStart,
			0,
			rowStart
		);
		vdp.clearSurfaceUploadDirty(slot.surfaceId);
	}
}
