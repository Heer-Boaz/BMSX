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
	textpageMemory: VdpAtlasMemory;
};

function imageAssetMemoryFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function textpageTexcoordRegionSize(textpageSize: number, offset: number, minCoord: number, maxCoord: number): number {
	const texels = Math.round((maxCoord - minCoord) * textpageSize);
	if (texels < 1) {
		return 1;
	}
	const remaining = textpageSize - offset;
	return texels < remaining ? texels : remaining;
}

function setAtlasEntryDimensions(slotEntry: AssetEntry, width: number, height: number): void {
	const size = width * height * 4;
	if (size > slotEntry.capacity) {
		throw imageAssetMemoryFault(`textpage entry '${slotEntry.id}' (${width}x${height}) exceeds capacity ${slotEntry.capacity}.`);
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
	const textpageSizesById = new Map<number, VdpAtlasSize>();
	const textpageViewIdsById = new Map<number, string[]>();
	const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	let engineAtlasRecord: RomAsset = null;
	for (let index = 0; index < engineRecords.length; index += 1) {
		const record = engineRecords[index];
		switch (record.type) {
			case 'image':
			case 'textpage':
				break;
			default:
				continue;
		}
		if (record.resid === engineAtlasName) {
			engineAtlasRecord = record;
		}
		const meta = record.imgmeta!;
		if (!meta.textpagesed || meta.textpageid !== ENGINE_ATLAS_INDEX) {
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
			case 'textpage':
				break;
			default:
				continue;
		}
		const meta = record.imgmeta!;
		if (record.type === 'textpage') {
			const textpageId = meta.textpageid!;
			if (meta.width <= 0 || meta.height <= 0) {
				throw imageAssetMemoryFault(`textpage '${record.resid}' missing dimensions.`);
			}
			textpageSizesById.set(textpageId, { width: meta.width, height: meta.height });
			continue;
		}
		if (meta.textpagesed && !viewResourceIds.has(record.resid)) {
			viewResourceIds.add(record.resid);
			viewRecords.push(record);
		}
	}

	const engineAtlasMeta = engineAtlasRecord.imgmeta!;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw imageAssetMemoryFault(`engine textpage '${engineAtlasName}' missing dimensions.`);
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
		const textpageId = meta.textpageid!;
		let textpageWidth = 0;
		let textpageHeight = 0;
		let baseEntry = primarySlotEntry;
		if (textpageId === ENGINE_ATLAS_INDEX) {
			baseEntry = engineEntry;
			textpageWidth = engineAtlasMeta.width;
			textpageHeight = engineAtlasMeta.height;
		} else {
			const textpageSize = textpageSizesById.get(textpageId)!;
			textpageWidth = textpageSize.width;
			textpageHeight = textpageSize.height;
		}
		const minU = Math.min(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
		const maxU = Math.max(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
		const minV = Math.min(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
		const maxV = Math.max(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
		const offsetX = Math.round(minU * textpageWidth);
		const offsetY = Math.round(minV * textpageHeight);
		const regionW = textpageTexcoordRegionSize(textpageWidth, offsetX, minU, maxU);
		const regionH = textpageTexcoordRegionSize(textpageHeight, offsetY, minV, maxV);
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
		let viewIds = textpageViewIdsById.get(textpageId);
		if (!viewIds) {
			viewIds = [];
			textpageViewIdsById.set(textpageId, viewIds);
		}
		viewIds.push(record.resid);
	}
	return { textpageMemory: { textpageSizesById, textpageViewIdsById } };
}
