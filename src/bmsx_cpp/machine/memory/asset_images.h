#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

class Memory;
class RuntimeAssets;
struct ImgAsset;

void registerImageMemory(Memory& memory, RuntimeAssets& engineAssets, RuntimeAssets& assets);

} // namespace bmsx
