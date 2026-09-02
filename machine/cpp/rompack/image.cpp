#include "rompack/image.h"

#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_package.h"

#include <utility>

namespace bmsx {

RomImage parseSystemRomImage(const u8* buffer, size_t size) {
	if (size > SYSTEM_ROM_SIZE) {
		throw BMSX_RUNTIME_ERROR("System ROM payload exceeds its address window.");
	}
	return RomImage{std::span<const u8>(buffer, size), parseCartHeader(buffer, size)};
}

void assertCartridgePackageFitsHardware(
	size_t byteCount,
	const CartRomHeader& header,
	std::span<const CartridgeDeviceConfig> hardware
) {
	if (byteCount > CART_PACKAGE_MAX_BYTE_COUNT) {
		throw BMSX_RUNTIME_ERROR("Cartridge package exceeds its format limit.");
	}
	bool romPresent = false;
	for (const CartridgeDeviceConfig& device : hardware) {
		if (std::holds_alternative<CartridgeRomDeviceConfig>(device)) {
			romPresent = true;
			if (byteCount > CART_ROM_SIZE) {
				throw BMSX_RUNTIME_ERROR("Cartridge ROM device exceeds its address window.");
			}
		}
	}
	if (!romPresent
			&& (header.blua32ImageOffset != 0u
				|| header.blua32ImageByteCount != 0u
				|| header.blua32StartupFunctionAddress != 0u
				|| header.blua32IrqFunctionAddress != 0u
				|| header.blua32ExceptionFunctionAddress != 0u
				|| header.blua32StaticLayoutTokenLo != 0u
				|| header.blua32StaticLayoutTokenHi != 0u)) {
		throw BMSX_RUNTIME_ERROR(
			"Cartridge BLua32 metadata requires an installed ROM device."
		);
	}
}

CartridgePackage parseCartridgePackage(const u8* buffer, size_t size) {
	const std::span<const u8> bytes(buffer, size);
	const CartRomHeader header = parseCartHeader(buffer, size);
	CartManifest manifest = decodeCartManifest(bytes, header);
	assertCartridgePackageFitsHardware(size, header, manifest.hardware);
	return CartridgePackage{bytes, header, std::move(manifest)};
}

} // namespace bmsx
