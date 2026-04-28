import { BIOS_ATLAS_ID, generateAtlasAssetId, type ImgMeta, type RuntimeRomPackage } from '../../rompack/format';
import type { RuntimeRomLayers } from '../../rompack/runtime_layers';
import type { VdpSlotSource } from '../../machine/devices/vdp/contracts';
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

function resolveImageFromPackage(packageRecords: RuntimeRomPackage, imgid: string): { imgmeta: ImgMeta } {
	const record = packageRecords.img[imgid];
	if (!record || !record.imgmeta) {
		throw new Error(`[VDPImageMeta] Image '${imgid}' is missing metadata.`);
	}
	return { imgmeta: record.imgmeta };
}

function resolveAtlasMeta(packageRecords: RuntimeRomPackage, atlasId: number): ImgMeta {
	const atlas = packageRecords.img[generateAtlasAssetId(atlasId)];
	if (!atlas || !atlas.imgmeta) {
		throw new Error(`[VDPImageMeta] Atlas ${atlasId} is missing metadata.`);
	}
	return atlas.imgmeta;
}

export function resolveImageAtlasRectFromPackage(packageRecords: RuntimeRomPackage, imgid: string): ImageAtlasRect {
	const meta = resolveImageFromPackage(packageRecords, imgid).imgmeta;
	if (meta.atlasid === undefined || !meta.texcoords) {
		throw new Error(`[VDPImageMeta] Image '${imgid}' is not an atlas-backed VDP image.`);
	}
	const atlasMeta = resolveAtlasMeta(packageRecords, meta.atlasid);
	const extents = getUvExtents(meta.texcoords);
	return {
		atlasId: meta.atlasid,
		u: Math.round(extents.minU * atlasMeta.width),
		v: Math.round(extents.minV * atlasMeta.height),
		w: meta.width,
		h: meta.height,
	};
}

export function resolveImageAtlasRect(rom: RuntimeRomLayers, imgid: string): ImageAtlasRect {
	const layers = [rom.overlayLayer, rom.cartLayer, rom.biosLayer];
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index];
		if (layer && layer.package.img[imgid]) {
			return resolveImageAtlasRectFromPackage(layer.package, imgid);
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

export function resolveImageSlotSource(memory: Memory, rom: RuntimeRomLayers, imgid: string): VdpSlotSource {
	const layers = [rom.overlayLayer, rom.cartLayer, rom.biosLayer];
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index];
		if (layer && layer.package.img[imgid]) {
			const rect = resolveImageAtlasRectFromPackage(layer.package, imgid);
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

export function resolveSystemImageSlotSource(rom: RuntimeRomLayers, imgid: string): VdpSlotSource {
	if (!rom.biosLayer) {
		throw new Error(`[VDPImageMeta] System ROM image '${imgid}' was requested before the BIOS layer was loaded.`);
	}
	const rect = resolveImageAtlasRectFromPackage(rom.biosLayer.package, imgid);
	if (rect.atlasId !== BIOS_ATLAS_ID) {
		throw new Error(`[VDPImageMeta] System ROM image '${imgid}' is not in the system atlas.`);
	}
	return {
		slot: VDP_SLOT_SYSTEM,
		u: rect.u,
		v: rect.v,
		w: rect.w,
		h: rect.h,
	};
}
