#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace bmsx {

class Runtime;
class RuntimeAssets;

struct RuntimeRomAssetRange {
	uint32_t romBase = 0;
	uint32_t start = 0;
	uint32_t end = 0;
};

enum class RuntimeAssetBuildMode {
	Full,
	Cart,
};

uint32_t romBaseForPayloadId(std::string_view payloadId);
RuntimeRomAssetRange resolveRuntimeRomAssetRange(const RuntimeAssets* cartAssets, const RuntimeAssets& systemAssets, const std::string& assetId, bool includeSystem);
void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode = RuntimeAssetBuildMode::Full);

} // namespace bmsx
