#include "machine/memory/asset_images.h"

#include "core/primitives.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "rompack/assets.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {

uint32_t textpageTexcoordRegionSize(uint32_t textpageSize, int32_t offset, f32 minCoord, f32 maxCoord) {
	const int32_t texels = static_cast<int32_t>(std::round((maxCoord - minCoord) * static_cast<f32>(textpageSize)));
	if (texels < 1) {
		return 1u;
	}
	const int32_t remaining = static_cast<int32_t>(textpageSize) - offset;
	return static_cast<uint32_t>(texels < remaining ? texels : remaining);
}

void setAtlasEntryDimensions(Memory::AssetEntry& slotEntry, uint32_t width, uint32_t height) {
	const uint32_t size = width * height * 4u;
	if (size > slotEntry.capacity) {
		throw BMSX_RUNTIME_ERROR("Atlas entry '" + slotEntry.id + "' exceeds capacity.");
	}
	slotEntry.baseSize = size;
	slotEntry.baseStride = width * 4u;
	slotEntry.regionX = 0u;
	slotEntry.regionY = 0u;
	slotEntry.regionW = width;
	slotEntry.regionH = height;
}

void seedAtlasSlot(Memory::AssetEntry& slotEntry) {
	const double maxPixels = static_cast<double>(slotEntry.capacity) / 4.0;
	const uint32_t side = static_cast<uint32_t>(std::floor(std::sqrt(maxPixels)));
	setAtlasEntryDimensions(slotEntry, side, side);
}

} // namespace

RegisteredImageMemory registerImageMemory(Memory& memory, RuntimeAssets& engineAssets, RuntimeAssets& assets) {
	RegisteredImageMemory registered;
	std::vector<std::string> viewAssets;
	viewAssets.reserve(assets.img.size() + engineAssets.img.size());
	std::unordered_set<std::string> viewAssetIds;
	viewAssetIds.reserve(assets.img.size() + engineAssets.img.size());
	std::unordered_map<std::string, const ImgAsset*> viewAssetById;
	viewAssetById.reserve(assets.img.size() + engineAssets.img.size());

	const std::string engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
	const ImgAsset* engineAtlasAsset = engineAssets.getImg(engineAtlasName);
	for (const auto& entry : engineAssets.img) {
		const ImgAsset& image = entry.second;
		if (!image.meta.textpagesed || image.meta.textpageid != ENGINE_ATLAS_INDEX) {
			continue;
		}
		if (viewAssetIds.insert(image.id).second) {
			viewAssets.push_back(image.id);
		}
		viewAssetById[image.id] = &image;
	}

	for (const auto& entry : assets.img) {
		const ImgAsset& image = entry.second;
		if (image.rom.type == "textpage") {
			if (image.meta.width <= 0 || image.meta.height <= 0) {
				throw BMSX_RUNTIME_ERROR("Atlas '" + image.id + "' missing dimensions.");
			}
			registered.textpageMemory.textpageSizesById[image.meta.textpageid] = VdpAtlasSize{
				static_cast<uint32_t>(image.meta.width),
				static_cast<uint32_t>(image.meta.height)
			};
			continue;
		}
		if (image.meta.textpagesed && viewAssetIds.insert(image.id).second) {
			viewAssets.push_back(image.id);
			viewAssetById[image.id] = &image;
		}
	}

	const auto& engineAtlasMeta = engineAtlasAsset->meta;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("Engine textpage missing dimensions.");
	}
	if (!memory.hasAsset(engineAtlasName)) {
		memory.registerImageSlotAt(
			engineAtlasName,
			VRAM_SYSTEM_ATLAS_BASE,
			VRAM_SYSTEM_ATLAS_SIZE,
			0,
			false
		);
	}
	auto& engineEntry = memory.getAssetEntry(engineAtlasName);
	setAtlasEntryDimensions(engineEntry, static_cast<uint32_t>(engineAtlasMeta.width), static_cast<uint32_t>(engineAtlasMeta.height));

	if (!memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)) {
		memory.registerImageSlotAt(
			ATLAS_PRIMARY_SLOT_ID,
			VRAM_PRIMARY_ATLAS_BASE,
			VRAM_PRIMARY_ATLAS_SIZE,
			0,
			false
		);
	}
	seedAtlasSlot(memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID));
	if (!memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)) {
		memory.registerImageSlotAt(
			ATLAS_SECONDARY_SLOT_ID,
			VRAM_SECONDARY_ATLAS_BASE,
			VRAM_SECONDARY_ATLAS_SIZE,
			0,
			false
		);
	}
	seedAtlasSlot(memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID));

	std::sort(viewAssets.begin(), viewAssets.end());
	for (const auto& id : viewAssets) {
		const ImgAsset& image = *viewAssetById.at(id);
		const i32 textpageId = image.meta.textpageid;
		const auto& tc = image.meta.texcoords;
		const f32 minU = std::min({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 maxU = std::max({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 minV = std::min({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const f32 maxV = std::max({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		std::string baseEntryId = ATLAS_PRIMARY_SLOT_ID;
		uint32_t textpageWidth = 0;
		uint32_t textpageHeight = 0;
		if (textpageId == ENGINE_ATLAS_INDEX) {
			baseEntryId = engineAtlasName;
			textpageWidth = static_cast<uint32_t>(engineAtlasMeta.width);
			textpageHeight = static_cast<uint32_t>(engineAtlasMeta.height);
		} else {
			const VdpAtlasSize& textpageSize = registered.textpageMemory.textpageSizesById.at(textpageId);
			textpageWidth = textpageSize.width;
			textpageHeight = textpageSize.height;
		}
		// start numeric-sanitization-acceptable -- textpage view bounds are reconstructed from float texcoords at the asset boundary.
		const int32_t offsetX = static_cast<int32_t>(std::round(minU * static_cast<f32>(textpageWidth)));
		const int32_t offsetY = static_cast<int32_t>(std::round(minV * static_cast<f32>(textpageHeight)));
		const uint32_t regionW = textpageTexcoordRegionSize(textpageWidth, offsetX, minU, maxU);
		const uint32_t regionH = textpageTexcoordRegionSize(textpageHeight, offsetY, minV, maxV);
		// end numeric-sanitization-acceptable
		if (!memory.hasAsset(id)) {
			memory.registerImageView(
				id,
				memory.getAssetEntry(baseEntryId),
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				regionW,
				regionH,
				0
			);
		} else {
			auto& viewEntry = memory.getAssetEntry(id);
			memory.updateImageView(
				viewEntry,
				memory.getAssetEntry(baseEntryId),
				static_cast<uint32_t>(offsetX),
				static_cast<uint32_t>(offsetY),
				regionW,
				regionH,
				0
			);
		}
		registered.textpageMemory.textpageViewIdsById[textpageId].push_back(id);
	}
	return registered;
}

} // namespace bmsx
