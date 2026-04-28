import { renderGate, runGate, taskGate } from './taskgate';
import { BIOS_ATLAS_ID, FRAMEBUFFER_RENDER_TEXTURE_KEY, generateAtlasAssetId, type RomAsset } from '../rompack/format';
import type { RuntimeRomLayer } from '../rompack/loader';
import type { Machine } from '../machine/machine';
import {
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_ATLAS_NONE,
} from '../machine/bus/io';
import type { VdpAtlasDimensions, VdpFrameBufferSize, VdpVramSurface } from '../machine/devices/vdp/contracts';
import {
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
} from '../machine/devices/vdp/contracts';
import {
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_SYSTEM_SLOT_SIZE,
} from '../machine/memory/map';

const ATLAS_ROM_ENTRY_PATTERN = /^_atlas_(\d+)$/;
const vdpSlotGate = taskGate.group('vdp:slots');

function assertSurfaceDimensions(id: string, width: number, height: number, capacity: number): void {
	const size = width * height * 4;
	if (size > capacity) {
		throw new Error(`VDP surface '${id}' (${width}x${height}) exceeds capacity ${capacity}.`);
	}
}

function resolveAtlasId(entry: RomAsset): number | null {
	if (entry.type !== 'atlas') {
		return null;
	}
	if (typeof entry.imgmeta?.atlasid === 'number') {
		return entry.imgmeta.atlasid;
	}
	const match = ATLAS_ROM_ENTRY_PATTERN.exec(entry.resid);
	return match ? Number(match[1]) : null;
}

function collectAtlasDimensions(layers: ReadonlyArray<RuntimeRomLayer | null>): Map<number, VdpAtlasDimensions> {
	const atlasDimensions = new Map<number, VdpAtlasDimensions>();
	for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
		const layer = layers[layerIndex];
		if (!layer) {
			continue;
		}
		for (const entry of Object.values(layer.package.img)) {
			const atlasId = resolveAtlasId(entry);
			const meta = entry.imgmeta;
			if (atlasId === null || !meta || meta.width <= 0 || meta.height <= 0) {
				continue;
			}
			atlasDimensions.set(atlasId, { width: meta.width, height: meta.height });
		}
	}
	return atlasDimensions;
}

function buildVdpSlotSurfaces(systemRecords: readonly RomAsset[], frameBufferSize: VdpFrameBufferSize): VdpVramSurface[] {
	const systemAtlasId = generateAtlasAssetId(BIOS_ATLAS_ID);
	let systemAtlasRecord: RomAsset = null;
	for (let index = 0; index < systemRecords.length; index += 1) {
		const record = systemRecords[index];
		switch (record.type) {
			case 'image':
			case 'atlas':
				break;
			default:
				continue;
		}
		if (record.resid === systemAtlasId) {
			systemAtlasRecord = record;
		}
	}

	if (!systemAtlasRecord || !systemAtlasRecord.imgmeta) {
		throw new Error(`system ROM atlas '${systemAtlasId}' missing metadata.`);
	}
	const systemAtlasMeta = systemAtlasRecord.imgmeta;
	if (systemAtlasMeta.width <= 0 || systemAtlasMeta.height <= 0) {
		throw new Error(`system ROM atlas '${systemAtlasId}' missing dimensions.`);
	}
	assertSurfaceDimensions(systemAtlasId, systemAtlasMeta.width, systemAtlasMeta.height, VRAM_SYSTEM_SLOT_SIZE);
	assertSurfaceDimensions(FRAMEBUFFER_RENDER_TEXTURE_KEY, frameBufferSize.width, frameBufferSize.height, VRAM_FRAMEBUFFER_SIZE);
	return [
		{
			surfaceId: VDP_RD_SURFACE_SYSTEM,
			baseAddr: VRAM_SYSTEM_SLOT_BASE,
			capacity: VRAM_SYSTEM_SLOT_SIZE,
			width: systemAtlasMeta.width,
			height: systemAtlasMeta.height,
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

export async function configureVdpSlots(params: {
	machine: Machine;
	systemRecords: readonly RomAsset[];
	layers: ReadonlyArray<RuntimeRomLayer | null>;
}): Promise<void> {
	const token = vdpSlotGate.begin({ blocking: true, category: 'vdp', tag: 'slots' });
	const renderToken = renderGate.begin({ blocking: true, category: 'vdp', tag: 'slots' });
	const runToken = runGate.begin({ blocking: true, category: 'vdp', tag: 'slots' });
	try {
		const memory = params.machine.memory;
		memory.writeValue(IO_VDP_SLOT_PRIMARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		memory.writeValue(IO_VDP_SLOT_SECONDARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		params.machine.vdp.registerVramSurfaces(
			buildVdpSlotSurfaces(params.systemRecords, params.machine.frameBufferSize),
			collectAtlasDimensions(params.layers),
		);
	} finally {
		runGate.end(runToken);
		renderGate.end(renderToken);
		vdpSlotGate.end(token);
	}
}
