import {
	TEXTPAGE_PRIMARY_SLOT_ID,
	TEXTPAGE_SECONDARY_SLOT_ID,
	BIOS_ATLAS_ID,
	generateAtlasAssetId,
	type RomAsset,
} from '../../../rompack/format';
import {
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_ATLAS_NONE,
} from '../../bus/io';
import {
	VRAM_PRIMARY_TEXTPAGE_BASE,
	VRAM_PRIMARY_TEXTPAGE_SIZE,
	VRAM_SECONDARY_TEXTPAGE_BASE,
	VRAM_SECONDARY_TEXTPAGE_SIZE,
	VRAM_SYSTEM_TEXTPAGE_BASE,
	VRAM_SYSTEM_TEXTPAGE_SIZE,
} from '../map';
import type { AssetEntry, Memory } from '../memory';

function imageAssetMemoryFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function setImageSlotDimensions(slotEntry: AssetEntry, width: number, height: number): void {
	const size = width * height * 4;
	if (size > slotEntry.capacity) {
		throw imageAssetMemoryFault(`image slot '${slotEntry.id}' (${width}x${height}) exceeds capacity ${slotEntry.capacity}.`);
	}
	slotEntry.baseSize = size;
	slotEntry.baseStride = width * 4;
	slotEntry.regionX = 0;
	slotEntry.regionY = 0;
	slotEntry.regionW = width;
	slotEntry.regionH = height;
}

function seedImageSlot(slotEntry: AssetEntry): void {
	setImageSlotDimensions(slotEntry, 1, 1);
}

export function registerImageMemory(memory: Memory, engineRecords: readonly RomAsset[]): void {
	const engineAtlasAssetId = generateAtlasAssetId(BIOS_ATLAS_ID);
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
		if (record.resid === engineAtlasAssetId) {
			engineAtlasRecord = record;
		}
	}

	const engineAtlasMeta = engineAtlasRecord.imgmeta!;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw imageAssetMemoryFault(`engine atlas '${engineAtlasAssetId}' missing dimensions.`);
	}
	const engineEntry = memory.hasAsset(engineAtlasAssetId)
		? memory.getAssetEntry(engineAtlasAssetId)
		: memory.registerImageSlotAt({
			id: engineAtlasAssetId,
			baseAddr: VRAM_SYSTEM_TEXTPAGE_BASE,
			capacityBytes: VRAM_SYSTEM_TEXTPAGE_SIZE,
			clear: false,
		});
	setImageSlotDimensions(engineEntry, engineAtlasMeta.width, engineAtlasMeta.height);

	const primarySlotEntry = memory.hasAsset(TEXTPAGE_PRIMARY_SLOT_ID)
		? memory.getAssetEntry(TEXTPAGE_PRIMARY_SLOT_ID)
		: memory.registerImageSlotAt({
			id: TEXTPAGE_PRIMARY_SLOT_ID,
			baseAddr: VRAM_PRIMARY_TEXTPAGE_BASE,
			capacityBytes: VRAM_PRIMARY_TEXTPAGE_SIZE,
			clear: false,
		});
	const secondarySlotEntry = memory.hasAsset(TEXTPAGE_SECONDARY_SLOT_ID)
		? memory.getAssetEntry(TEXTPAGE_SECONDARY_SLOT_ID)
		: memory.registerImageSlotAt({
			id: TEXTPAGE_SECONDARY_SLOT_ID,
			baseAddr: VRAM_SECONDARY_TEXTPAGE_BASE,
			capacityBytes: VRAM_SECONDARY_TEXTPAGE_SIZE,
			clear: false,
	});
	seedImageSlot(primarySlotEntry);
	seedImageSlot(secondarySlotEntry);
	memory.writeValue(IO_VDP_SLOT_PRIMARY_ATLAS, VDP_SLOT_ATLAS_NONE);
	memory.writeValue(IO_VDP_SLOT_SECONDARY_ATLAS, VDP_SLOT_ATLAS_NONE);
}
