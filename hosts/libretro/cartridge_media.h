#pragma once

#include "machine/devices/cartridge/contracts.h"
#include "rompack/image.h"

namespace bmsx {

CartridgeCardMedia cartridgeMediaFromPackage(const CartridgePackage& package);

} // namespace bmsx
