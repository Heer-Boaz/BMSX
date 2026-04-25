#pragma once

namespace bmsx {

class Runtime;
class RuntimeAssets;

enum class RuntimeAssetBuildMode {
	Full,
	Cart,
};

void buildAssetMemory(Runtime& runtime, RuntimeAssets& engineAssets, RuntimeAssets& assets, RuntimeAssetBuildMode mode = RuntimeAssetBuildMode::Full);

} // namespace bmsx
