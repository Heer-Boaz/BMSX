import { $ } from '../../core/engine';
import type { VDP, VdpRenderTextureSlot } from '../../machine/devices/vdp/vdp';
import { ENGINE_ATLAS_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY } from '../../rompack/format';
import {
	ensureVdpTextureFromSeed,
	resizeVdpTextureForKey,
	updateVdpTextureRegion,
	vdpTextureByUri,
} from './texture_transfer';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);
const syncedTextureSizesByKey = new Map<string, number>();

function packTextureSize(width: number, height: number): number {
	return width * 0x10000 + height;
}

function ensureVdpSlotTexture(slot: VdpRenderTextureSlot): boolean {
	const width = slot.entry.regionW;
	const height = slot.entry.regionH;
	const packedSize = packTextureSize(width, height);
	const syncedSize = syncedTextureSizesByKey.get(slot.textureKey);
	if (slot.textureKey === ENGINE_ATLAS_TEXTURE_KEY) {
		if (!vdpTextureByUri(slot.textureKey) || syncedSize !== packedSize) {
			$.view.loadEngineAtlasTexture();
			syncedTextureSizesByKey.set(slot.textureKey, packedSize);
		}
		return false;
	}
	const handle = vdpTextureByUri(slot.textureKey);
	if (!handle) {
		ensureVdpTextureFromSeed(slot.textureKey, EMPTY_TEXTURE_SEED, width, height);
		syncedTextureSizesByKey.set(slot.textureKey, packedSize);
		return true;
	}
	if (syncedSize === packedSize) {
		return false;
	}
	resizeVdpTextureForKey(slot.textureKey, width, height);
	syncedTextureSizesByKey.set(slot.textureKey, packedSize);
	return true;
}

export function syncVdpSlotTextures(vdp: VDP): void {
	const slots = vdp.renderTextureSlots;
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index];
		if (slot.textureKey === FRAMEBUFFER_RENDER_TEXTURE_KEY) {
			continue;
		}
		const forceFullUpload = ensureVdpSlotTexture(slot);
		if (!forceFullUpload && slot.dirtyRowStart >= slot.dirtyRowEnd) {
			continue;
		}
		const rowStart = forceFullUpload ? 0 : slot.dirtyRowStart;
		const rowEnd = forceFullUpload ? slot.entry.regionH : slot.dirtyRowEnd;
		const rowBytes = slot.entry.regionW * 4;
		updateVdpTextureRegion(
			slot.textureKey,
			slot.cpuReadback.subarray(rowStart * rowBytes, rowEnd * rowBytes),
			slot.entry.regionW,
			rowEnd - rowStart,
			0,
			rowStart
		);
		vdp.clearRenderTextureSlotDirty(slot.textureKey);
	}
}
