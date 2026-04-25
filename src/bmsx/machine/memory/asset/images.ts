import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	generateAtlasName,
	type RomAsset,
} from '../../../rompack/format';
import type { VdpAtlasMemory, VdpAtlasSize } from '../../devices/vdp/vdp';
import {
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
} from '../map';
import type { AssetEntry, Memory } from '../memory';

export type RegisteredImageMemory = {
	atlasMemory: VdpAtlasMemory;
};

function imageAssetMemoryFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function atlasTexcoordRegionSize(atlasSize: number, offset: number, minCoord: number, maxCoord: number): number {
	const texels = Math.round((maxCoord - minCoord) * atlasSize);
	if (texels < 1) {
		return 1;
	}
	const remaining = atlasSize - offset;
	return texels < remaining ? texels : remaining;
}

function setAtlasEntryDimensions(slotEntry: AssetEntry, width: number, height: number): void {
	const size = width * height * 4;
	if (size > slotEntry.capacity) {
		throw imageAssetMemoryFault(`atlas entry '${slotEntry.id}' (${width}x${height}) exceeds capacity ${slotEntry.capacity}.`);
	}
	slotEntry.baseSize = size;
	slotEntry.baseStride = width * 4;
	slotEntry.regionX = 0;
	slotEntry.regionY = 0;
	slotEntry.regionW = width;
	slotEntry.regionH = height;
}

function seedAtlasSlot(slotEntry: AssetEntry): void {
	const maxPixels = Math.floor(slotEntry.capacity / 4);
	const side = Math.floor(Math.sqrt(maxPixels));
	setAtlasEntryDimensions(slotEntry, side, side);
}

export function registerImageMemory(memory: Memory, engineRecords: readonly RomAsset[], records: readonly RomAsset[]): RegisteredImageMemory {
	const viewRecords: RomAsset[] = [];
	const viewResourceIds = new Set<string>();
	const atlasSizesById = new Map<number, VdpAtlasSize>();
	const atlasViewIdsById = new Map<number, string[]>();
	const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	let engineAtlasRecord: RomAsset = null;
	for (let index = 0; index < engineRecords.length; index += 1) {
		const record = engineRecords[index];
		switch (record.type) {
			case 'image':
			case 'atlas':
				break;
			default:
				continue;
		}
		if (record.resid === engineAtlasName) {
			engineAtlasRecord = record;
		}
		const meta = record.imgmeta!;
		if (!meta.atlassed || meta.atlasid !== ENGINE_ATLAS_INDEX) {
			continue;
		}
		if (viewResourceIds.has(record.resid)) {
			continue;
		}
		viewResourceIds.add(record.resid);
		viewRecords.push(record);
	}

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		switch (record.type) {
			case 'image':
			case 'atlas':
				break;
			default:
				continue;
		}
		const meta = record.imgmeta!;
		if (record.type === 'atlas') {
			const atlasId = meta.atlasid!;
			if (meta.width <= 0 || meta.height <= 0) {
				throw imageAssetMemoryFault(`atlas '${record.resid}' missing dimensions.`);
			}
			atlasSizesById.set(atlasId, { width: meta.width, height: meta.height });
			continue;
		}
		if (meta.atlassed && !viewResourceIds.has(record.resid)) {
			viewResourceIds.add(record.resid);
			viewRecords.push(record);
		}
	}

	const engineAtlasMeta = engineAtlasRecord.imgmeta!;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw imageAssetMemoryFault(`engine atlas '${engineAtlasName}' missing dimensions.`);
	}
	const engineEntry = memory.hasAsset(engineAtlasName)
		? memory.getAssetEntry(engineAtlasName)
		: memory.registerImageSlotAt({
			id: engineAtlasName,
			baseAddr: VRAM_SYSTEM_ATLAS_BASE,
			capacityBytes: VRAM_SYSTEM_ATLAS_SIZE,
			clear: false,
		});
	setAtlasEntryDimensions(engineEntry, engineAtlasMeta.width, engineAtlasMeta.height);

	const primarySlotEntry = memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)
		? memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID)
		: memory.registerImageSlotAt({
			id: ATLAS_PRIMARY_SLOT_ID,
			baseAddr: VRAM_PRIMARY_ATLAS_BASE,
			capacityBytes: VRAM_PRIMARY_ATLAS_SIZE,
			clear: false,
		});
	const secondarySlotEntry = memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)
		? memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID)
		: memory.registerImageSlotAt({
			id: ATLAS_SECONDARY_SLOT_ID,
			baseAddr: VRAM_SECONDARY_ATLAS_BASE,
			capacityBytes: VRAM_SECONDARY_ATLAS_SIZE,
			clear: false,
		});
	seedAtlasSlot(primarySlotEntry);
	seedAtlasSlot(secondarySlotEntry);

	viewRecords.sort((lhs, rhs) => lhs.resid < rhs.resid ? -1 : lhs.resid > rhs.resid ? 1 : 0);
	for (let index = 0; index < viewRecords.length; index += 1) {
		const record = viewRecords[index];
		const meta = record.imgmeta!;
		const coords = meta.texcoords!;
		const atlasId = meta.atlasid!;
		let atlasWidth = 0;
		let atlasHeight = 0;
		let baseEntry = primarySlotEntry;
		if (atlasId === ENGINE_ATLAS_INDEX) {
			baseEntry = engineEntry;
			atlasWidth = engineAtlasMeta.width;
			atlasHeight = engineAtlasMeta.height;
		} else {
			const atlasSize = atlasSizesById.get(atlasId)!;
			atlasWidth = atlasSize.width;
			atlasHeight = atlasSize.height;
		}
		const minU = Math.min(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
		const maxU = Math.max(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
		const minV = Math.min(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
		const maxV = Math.max(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
		const offsetX = Math.round(minU * atlasWidth);
		const offsetY = Math.round(minV * atlasHeight);
		const regionW = atlasTexcoordRegionSize(atlasWidth, offsetX, minU, maxU);
		const regionH = atlasTexcoordRegionSize(atlasHeight, offsetY, minV, maxV);
		if (!memory.hasAsset(record.resid)) {
			memory.registerImageView({
				id: record.resid,
				baseEntry,
				regionX: offsetX,
				regionY: offsetY,
				regionW,
				regionH,
			});
		}
		let viewIds = atlasViewIdsById.get(atlasId);
		if (!viewIds) {
			viewIds = [];
			atlasViewIdsById.set(atlasId, viewIds);
		}
		viewIds.push(record.resid);
	}
	return { atlasMemory: { atlasSizesById, atlasViewIdsById } };
}
