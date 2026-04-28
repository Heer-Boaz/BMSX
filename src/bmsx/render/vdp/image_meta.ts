import { BIOS_ATLAS_ID, generateAtlasAssetId, type ImgMeta, type RuntimeAssets } from '../../rompack/format';
import type { RuntimeAssetState } from '../../machine/memory/asset/state';
import type { VdpSlotSource } from '../../machine/devices/vdp/vdp';
import {
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
} from '../../machine/bus/io';
import type { Memory } from '../../machine/memory/memory';

export type ImageAtlasRect = {
	atlasId: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

function getUvExtents(texcoords: readonly number[]): { minU: number; minV: number; maxU: number; maxV: number } {
	let minU = texcoords[0];
	let maxU = texcoords[0];
	let minV = texcoords[1];
	let maxV = texcoords[1];
	for (let index = 2; index < 12; index += 2) {
		const u = texcoords[index];
		const v = texcoords[index + 1];
		if (u < minU) minU = u;
		if (u > maxU) maxU = u;
		if (v < minV) minV = v;
		if (v > maxV) maxV = v;
	}
	return { minU, minV, maxU, maxV };
}

function resolveImageFromAssets(assets: RuntimeAssets, imgid: string): { imgmeta: ImgMeta } {
	const asset = assets.img[imgid];
	if (!asset || !asset.imgmeta) {
		throw new Error(`[VDPImageMeta] Image '${imgid}' is missing metadata.`);
	}
	return { imgmeta: asset.imgmeta };
}

function resolveAtlasMeta(assets: RuntimeAssets, atlasId: number): ImgMeta {
	const atlas = assets.img[generateAtlasAssetId(atlasId)];
	if (!atlas || !atlas.imgmeta) {
		throw new Error(`[VDPImageMeta] Atlas ${atlasId} is missing metadata.`);
	}
	return atlas.imgmeta;
}

export function resolveImageAtlasRectFromAssets(assets: RuntimeAssets, imgid: string): ImageAtlasRect {
	const meta = resolveImageFromAssets(assets, imgid).imgmeta;
	if (meta.atlasid === undefined || !meta.texcoords) {
		throw new Error(`[VDPImageMeta] Image '${imgid}' is not an atlas-backed VDP image.`);
	}
	const atlasMeta = resolveAtlasMeta(assets, meta.atlasid);
	const extents = getUvExtents(meta.texcoords);
	return {
		atlasId: meta.atlasid,
		u: Math.round(extents.minU * atlasMeta.width),
		v: Math.round(extents.minV * atlasMeta.height),
		w: meta.width,
		h: meta.height,
	};
}

export function resolveImageAtlasRect(assets: RuntimeAssetState, imgid: string): ImageAtlasRect {
	const layers = [assets.overlayLayer, assets.cartLayer, assets.biosLayer];
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index];
		if (layer && layer.assets.img[imgid]) {
			return resolveImageAtlasRectFromAssets(layer.assets, imgid);
		}
	}
	throw new Error(`[VDPImageMeta] Image '${imgid}' was not found.`);
}

export function resolveAtlasSlotFromMemory(memory: Memory, atlasId: number): number {
	if (atlasId === BIOS_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	if (memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) === (atlasId >>> 0)) {
		return VDP_SLOT_PRIMARY;
	}
	if (memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) === (atlasId >>> 0)) {
		return VDP_SLOT_SECONDARY;
	}
	throw new Error(`[VDPImageMeta] Atlas ${atlasId} is not loaded in a VDP slot.`);
}

export function resolveImageSlotSource(memory: Memory, assets: RuntimeAssetState, imgid: string): VdpSlotSource {
	const layers = [assets.overlayLayer, assets.cartLayer, assets.biosLayer];
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index];
		if (layer && layer.assets.img[imgid]) {
			const rect = resolveImageAtlasRectFromAssets(layer.assets, imgid);
			return {
				slot: resolveAtlasSlotFromMemory(memory, rect.atlasId),
				u: rect.u,
				v: rect.v,
				w: rect.w,
				h: rect.h,
			};
		}
	}
	throw new Error(`[VDPImageMeta] Image '${imgid}' was not found.`);
}

export function resolveEngineImageSlotSource(assets: RuntimeAssetState, imgid: string): VdpSlotSource {
	if (!assets.biosLayer) {
		throw new Error('[VDPImageMeta] BIOS asset layer is not configured.');
	}
	const rect = resolveImageAtlasRectFromAssets(assets.biosLayer.assets, imgid);
	if (rect.atlasId !== BIOS_ATLAS_ID) {
		throw new Error(`[VDPImageMeta] Engine image '${imgid}' is not in the system atlas.`);
	}
	return {
		slot: VDP_SLOT_SYSTEM,
		u: rect.u,
		v: rect.v,
		w: rect.w,
		h: rect.h,
	};
}
