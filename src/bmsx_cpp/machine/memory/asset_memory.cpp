#include "machine/memory/asset_memory.h"

#include "machine/memory/asset_images.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <cctype>
#include <optional>
#include <utility>

namespace bmsx {
namespace {

std::optional<i32> parseAtlasIdFromAssetId(const std::string& id) {
	const std::string prefix = "_atlas_";
	if (id.rfind(prefix, 0) != 0) {
		return std::nullopt;
	}
	i32 value = 0;
	for (size_t index = prefix.size(); index < id.size(); ++index) {
		const unsigned char ch = static_cast<unsigned char>(id[index]);
		if (!std::isdigit(ch)) {
			return std::nullopt;
		}
		value = value * 10 + static_cast<i32>(ch - '0');
	}
	return value;
}

void appendAtlasDimensions(VdpAtlasDimensionsById& out, const RuntimeAssets& assets) {
	for (const auto& pair : assets.img) {
		const ImgAsset& asset = pair.second;
		if (asset.rom.type != "atlas") {
			continue;
		}
		const std::optional<i32> parsedId = asset.meta.atlasid ? asset.meta.atlasid : parseAtlasIdFromAssetId(asset.id);
		if (!parsedId || asset.meta.width <= 0 || asset.meta.height <= 0) {
			continue;
		}
		out[*parsedId] = VdpAtlasDimensions{
			static_cast<uint32_t>(asset.meta.width),
			static_cast<uint32_t>(asset.meta.height),
		};
	}
}

VdpAtlasDimensionsById collectAtlasDimensions(const RuntimeAssets& engineAssets, const RuntimeAssets& assets) {
	VdpAtlasDimensionsById dimensions;
	appendAtlasDimensions(dimensions, engineAssets);
	appendAtlasDimensions(dimensions, assets);
	return dimensions;
}

} // namespace

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	if (mode == RuntimeAssetBuildMode::Cart) {
		memory.resetCartAssets();
	} else {
		memory.resetAssetMemory();
	}
	registerImageMemory(memory, engineAssets, assets);
	machine.vdp().registerVramAssets(collectAtlasDimensions(engineAssets, assets));

	memory.finalizeAssetTable();
	memory.markAllAssetsDirty();
}

} // namespace bmsx
