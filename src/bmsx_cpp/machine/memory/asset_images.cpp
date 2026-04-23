#include "machine/memory/asset_images.h"

#include "core/primitives.h"
#include "machine/memory/asset_memory.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "rompack/assets.h"
#include "vendor/stb_image.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {

struct DecodedImageRecord {
	std::vector<u8> pixels;
	uint32_t width = 0;
	uint32_t height = 0;
};

uint32_t atlasTexcoordRegionSize(uint32_t atlasSize, int32_t offset, f32 minCoord, f32 maxCoord) {
	const int32_t texels = static_cast<int32_t>(std::round((maxCoord - minCoord) * static_cast<f32>(atlasSize)));
	if (texels < 1) {
		return 1u;
	}
	const int32_t remaining = static_cast<int32_t>(atlasSize) - offset;
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

DecodedImageRecord decodeImageRecordPixels(const Memory& memory, const ImgAsset& asset) {
	if (!asset.rom.payloadId.has_value()) {
		throw BMSX_RUNTIME_ERROR("Image asset '" + asset.id + "' missing payload id.");
	}
	if (!asset.rom.start.has_value() || !asset.rom.end.has_value()) {
		throw BMSX_RUNTIME_ERROR("Image asset '" + asset.id + "' missing ROM byte range.");
	}
	const uint32_t romBase = romBaseForPayloadId(*asset.rom.payloadId);
	const size_t start = static_cast<size_t>(*asset.rom.start);
	const size_t end = static_cast<size_t>(*asset.rom.end);
	if (end <= start) {
		throw BMSX_RUNTIME_ERROR("Image asset '" + asset.id + "' ROM byte range is invalid.");
	}
	std::vector<u8> encoded(end - start);
	memory.readBytes(romBase + static_cast<uint32_t>(start), encoded.data(), encoded.size());
	int width = 0;
	int height = 0;
	int comp = 0;
	unsigned char* decoded = stbi_load_from_memory(
		encoded.data(),
		static_cast<int>(encoded.size()),
		&width,
		&height,
		&comp,
		4
	);
	if (!decoded) {
		throw BMSX_RUNTIME_ERROR("Image asset '" + asset.id + "' decode failed.");
	}
	if (width != asset.meta.width || height != asset.meta.height) {
		stbi_image_free(decoded);
		throw BMSX_RUNTIME_ERROR("Image asset '" + asset.id + "' decoded dimensions do not match metadata.");
	}
	DecodedImageRecord record;
	record.width = static_cast<uint32_t>(width);
	record.height = static_cast<uint32_t>(height);
	record.pixels.resize(static_cast<size_t>(record.width) * static_cast<size_t>(record.height) * 4u);
	std::memcpy(record.pixels.data(), decoded, record.pixels.size());
	stbi_image_free(decoded);
	return record;
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
	registered.engineAtlasAsset = engineAssets.getImg(engineAtlasName);
	for (const auto& entry : engineAssets.img) {
		const ImgAsset& image = entry.second;
		if (!image.meta.atlassed || image.meta.atlasid != ENGINE_ATLAS_INDEX) {
			continue;
		}
		if (viewAssetIds.insert(image.id).second) {
			viewAssets.push_back(image.id);
		}
		viewAssetById[image.id] = &image;
	}

	for (const auto& entry : assets.img) {
		const ImgAsset& image = entry.second;
		if (image.rom.type == "atlas") {
			if (image.meta.width <= 0 || image.meta.height <= 0) {
				throw BMSX_RUNTIME_ERROR("Atlas '" + image.id + "' missing dimensions.");
			}
			registered.atlasMemory.atlasSizesById[image.meta.atlasid] = VdpAtlasSize{
				static_cast<uint32_t>(image.meta.width),
				static_cast<uint32_t>(image.meta.height)
			};
			continue;
		}
		if (image.meta.atlassed && viewAssetIds.insert(image.id).second) {
			viewAssets.push_back(image.id);
			viewAssetById[image.id] = &image;
		}
	}

	const auto& engineAtlasMeta = registered.engineAtlasAsset->meta;
	if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
		throw BMSX_RUNTIME_ERROR("Engine atlas missing dimensions.");
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
		const i32 atlasId = image.meta.atlasid;
		const auto& tc = image.meta.texcoords;
		const f32 minU = std::min({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 maxU = std::max({tc[0], tc[2], tc[4], tc[6], tc[8], tc[10]});
		const f32 minV = std::min({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		const f32 maxV = std::max({tc[1], tc[3], tc[5], tc[7], tc[9], tc[11]});
		std::string baseEntryId = ATLAS_PRIMARY_SLOT_ID;
		uint32_t atlasWidth = 0;
		uint32_t atlasHeight = 0;
		if (atlasId == ENGINE_ATLAS_INDEX) {
			baseEntryId = engineAtlasName;
			atlasWidth = static_cast<uint32_t>(engineAtlasMeta.width);
			atlasHeight = static_cast<uint32_t>(engineAtlasMeta.height);
		} else {
			const VdpAtlasSize& atlasSize = registered.atlasMemory.atlasSizesById.at(atlasId);
			atlasWidth = atlasSize.width;
			atlasHeight = atlasSize.height;
		}
		// start numeric-sanitization-acceptable -- atlas view bounds are reconstructed from float texcoords at the asset boundary.
		const int32_t offsetX = static_cast<int32_t>(std::round(minU * static_cast<f32>(atlasWidth)));
		const int32_t offsetY = static_cast<int32_t>(std::round(minV * static_cast<f32>(atlasHeight)));
		const uint32_t regionW = atlasTexcoordRegionSize(atlasWidth, offsetX, minU, maxU);
		const uint32_t regionH = atlasTexcoordRegionSize(atlasHeight, offsetY, minV, maxV);
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
		registered.atlasMemory.atlasViewIdsById[atlasId].push_back(id);
	}
	return registered;
}

void restoreEngineAtlas(Memory& memory, const ImgAsset& asset) {
	DecodedImageRecord decoded = decodeImageRecordPixels(memory, asset);
	auto& entry = memory.getAssetEntry(asset.id);
	const Memory::ImageWritePlan plan = memory.planImageSlotWrite(
		entry,
		decoded.pixels.size(),
		decoded.width,
		decoded.height,
		entry.capacity
	);
	if (plan.clipped) {
		throw BMSX_RUNTIME_ERROR("Engine atlas '" + asset.id + "' does not fit in system atlas slot.");
	}
	memory.writeBytes(entry.baseAddr, decoded.pixels.data(), plan.writeLen);
}

} // namespace bmsx
