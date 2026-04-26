#include "machine/memory/asset_images.h"

#include "core/primitives.h"
#include "machine/bus/io.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "rompack/assets.h"

#include <string>

namespace bmsx {
namespace {

void setImageSlotDimensions(Memory::AssetEntry& slotEntry, uint32_t width, uint32_t height) {
	const uint32_t size = width * height * 4u;
	if (size > slotEntry.capacity) {
		throw BMSX_RUNTIME_ERROR("Image slot '" + slotEntry.id + "' exceeds capacity.");
	}
	slotEntry.baseSize = size;
	slotEntry.baseStride = width * 4u;
	slotEntry.regionX = 0u;
	slotEntry.regionY = 0u;
	slotEntry.regionW = width;
	slotEntry.regionH = height;
}

void seedImageSlot(Memory::AssetEntry& slotEntry) {
	setImageSlotDimensions(slotEntry, 1u, 1u);
}

} // namespace

void registerImageMemory(Memory& memory, RuntimeAssets& engineAssets, RuntimeAssets&) {
	const std::string engineAtlasAssetId = generateAtlasAssetId(BIOS_ATLAS_ID);
	const ImgAsset* engineAtlasAsset = engineAssets.getImg(engineAtlasAssetId);

	const auto& engineAtlasMeta = engineAtlasAsset->meta;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("Engine atlas missing dimensions.");
	}
	if (!memory.hasAsset(engineAtlasAssetId)) {
		memory.registerImageSlotAt(
			engineAtlasAssetId,
			VRAM_SYSTEM_TEXTPAGE_BASE,
			VRAM_SYSTEM_TEXTPAGE_SIZE,
			0,
			false
		);
	}
	auto& engineEntry = memory.getAssetEntry(engineAtlasAssetId);
	setImageSlotDimensions(engineEntry, static_cast<uint32_t>(engineAtlasMeta.width), static_cast<uint32_t>(engineAtlasMeta.height));

	if (!memory.hasAsset(TEXTPAGE_PRIMARY_SLOT_ID)) {
		memory.registerImageSlotAt(
			TEXTPAGE_PRIMARY_SLOT_ID,
			VRAM_PRIMARY_TEXTPAGE_BASE,
			VRAM_PRIMARY_TEXTPAGE_SIZE,
			0,
			false
		);
	}
	seedImageSlot(memory.getAssetEntry(TEXTPAGE_PRIMARY_SLOT_ID));
	if (!memory.hasAsset(TEXTPAGE_SECONDARY_SLOT_ID)) {
		memory.registerImageSlotAt(
			TEXTPAGE_SECONDARY_SLOT_ID,
			VRAM_SECONDARY_TEXTPAGE_BASE,
			VRAM_SECONDARY_TEXTPAGE_SIZE,
			0,
			false
		);
	}
	seedImageSlot(memory.getAssetEntry(TEXTPAGE_SECONDARY_SLOT_ID));
	memory.writeValue(IO_VDP_SLOT_PRIMARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
	memory.writeValue(IO_VDP_SLOT_SECONDARY_ATLAS, valueNumber(static_cast<double>(VDP_SLOT_ATLAS_NONE)));
}

} // namespace bmsx
