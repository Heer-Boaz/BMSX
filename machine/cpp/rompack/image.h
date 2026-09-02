/*
 * image.h - Physical BMSX ROM image admission
 */

#ifndef BMSX_ROMPACK_IMAGE_H
#define BMSX_ROMPACK_IMAGE_H

#include "common/primitives.h"
#include "rompack/format.h"
#include "rompack/manifest.h"

#include <span>

namespace bmsx {

struct RomImage {
	std::span<const u8> bytes;
	CartRomHeader header;
};

struct CartridgePackage {
	std::span<const u8> bytes;
	CartRomHeader header;
	CartManifest manifest;
};

RomImage parseSystemRomImage(const u8* buffer, size_t size);
void assertCartridgePackageFitsHardware(
	size_t byteCount,
	const CartRomHeader& header,
	std::span<const CartridgeDeviceConfig> hardware
);
CartridgePackage parseCartridgePackage(const u8* buffer, size_t size);

} // namespace bmsx

#endif // BMSX_ROMPACK_IMAGE_H
