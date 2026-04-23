#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

class Memory;
class RuntimeAssets;
struct ImgAsset;

struct RegisteredImageMemory {
	VdpAtlasMemory atlasMemory;
	const ImgAsset* engineAtlasAsset = nullptr;
};

RegisteredImageMemory registerImageMemory(Memory& memory, RuntimeAssets& engineAssets, RuntimeAssets& assets);
void restoreEngineAtlas(Memory& memory, const ImgAsset& asset);

} // namespace bmsx
