#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

class Memory;
class RuntimeAssets;
struct ImgAsset;

struct RegisteredImageMemory {
	VdpAtlasMemory atlasMemory;
};

RegisteredImageMemory registerImageMemory(Memory& memory, RuntimeAssets& engineAssets, RuntimeAssets& assets);

} // namespace bmsx
