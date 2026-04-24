#include "machine/memory/asset_memory.h"

#include "core/primitives.h"
#include "machine/memory/asset_images.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

namespace bmsx {
namespace {

const RomAssetInfo* findRomAssetInfo(const RuntimeAssets& assets, const std::string& assetId) {
	if (const ImgAsset* image = assets.getImg(assetId)) {
		return &image->rom;
	}
	if (const AudioAsset* audio = assets.getAudio(assetId)) {
		return &audio->rom;
	}
	const AssetToken token = hashAssetToken(assetId);
	auto dataIt = assets.data.find(token);
	if (dataIt != assets.data.end()) {
		return &dataIt->second.rom;
	}
	auto binIt = assets.bin.find(token);
	if (binIt != assets.bin.end()) {
		return &binIt->second.rom;
	}
	auto luaIt = assets.lua.find(token);
	if (luaIt != assets.lua.end()) {
		return &luaIt->second.rom;
	}
	auto eventIt = assets.audioevents.find(token);
	if (eventIt != assets.audioevents.end()) {
		return &eventIt->second.rom;
	}
	return nullptr;
}

RuntimeRomAssetRange resolveRomAssetRangeFromInfo(const RomAssetInfo& rom, const std::string& assetId) {
	if (!rom.payloadId) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' is missing a payload id.");
	}
	if (!rom.start || !rom.end) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' is missing ROM range.");
	}
	return RuntimeRomAssetRange{
		romBaseForPayloadId(*rom.payloadId),
		static_cast<uint32_t>(*rom.start),
		static_cast<uint32_t>(*rom.end),
	};
}

} // namespace

uint32_t romBaseForPayloadId(std::string_view payloadId) {
	if (payloadId == "system") {
		return SYSTEM_ROM_BASE;
	}
	if (payloadId == "overlay") {
		return OVERLAY_ROM_BASE;
	}
	if (payloadId == "cart") {
		return CART_ROM_BASE;
	}
	throw BMSX_RUNTIME_ERROR("Asset payload id '" + std::string(payloadId) + "' has no ROM base.");
}

RuntimeRomAssetRange resolveRuntimeRomAssetRange(const RuntimeAssets* cartAssets, const RuntimeAssets& systemAssets, const std::string& assetId, bool includeSystem) {
	const RomAssetInfo* rom = nullptr;
	if (cartAssets) {
		rom = findRomAssetInfo(*cartAssets, assetId);
	}
	if (rom == nullptr && includeSystem) {
		rom = findRomAssetInfo(systemAssets, assetId);
	}
	if (rom == nullptr) {
		throw BMSX_RUNTIME_ERROR("Asset '" + assetId + "' does not exist.");
	}
	return resolveRomAssetRangeFromInfo(*rom, assetId);
}

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode) {
	auto& machine = runtime.machine();
	auto& memory = machine.memory();
	if (mode == RuntimeAssetBuildMode::Cart) {
		memory.resetCartAssets();
	} else {
		memory.resetAssetMemory();
	}
	RegisteredImageMemory imageMemory = registerImageMemory(memory, engineAssets, assets);
	machine.vdp().registerVramAssets(std::move(imageMemory.atlasMemory));
	restoreEngineAtlas(memory, *imageMemory.engineAtlasAsset);
	std::vector<const AudioAsset*> audioAssets;
	audioAssets.reserve(assets.audio.size());
	for (const auto& entry : assets.audio) {
		const auto& audioAsset = entry.second;
		audioAssets.push_back(&audioAsset);
	}
	std::sort(audioAssets.begin(), audioAssets.end(), [](const AudioAsset* lhs, const AudioAsset* rhs) {
		return lhs->id < rhs->id;
	});
	for (const auto* audioAsset : audioAssets) {
		const std::string& id = audioAsset->id;
		if (memory.hasAsset(id)) {
			continue;
		}
		memory.registerAudioMeta(
			id,
			static_cast<uint32_t>(audioAsset->sampleRate),
			static_cast<uint32_t>(audioAsset->channels),
			static_cast<uint32_t>(audioAsset->bitsPerSample),
			static_cast<uint32_t>(audioAsset->frames),
			static_cast<uint32_t>(audioAsset->dataOffset),
			static_cast<uint32_t>(audioAsset->dataSize)
		);
	}

	memory.finalizeAssetTable();
	memory.markAllAssetsDirty();
}

} // namespace bmsx
