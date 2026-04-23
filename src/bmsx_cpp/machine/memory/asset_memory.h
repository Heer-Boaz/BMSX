#pragma once

#include <cstdint>
#include <string_view>

namespace bmsx {

class Runtime;
class RuntimeAssets;

enum class RuntimeAssetBuildMode {
	Full,
	Cart,
};

uint32_t romBaseForPayloadId(std::string_view payloadId);
void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode = RuntimeAssetBuildMode::Full);

} // namespace bmsx
