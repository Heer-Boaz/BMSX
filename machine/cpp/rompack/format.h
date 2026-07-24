/*
 * format.h - ROM pack utilities
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "common/primitives.h"
#include "machine/cpu/blua32_image.h"
#include "machine/model_registry.h"
#include <array>
#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace bmsx {

enum class RomImageDomain {
	System,
	Cartridge,
};

constexpr u32 CART_ROM_MAGIC = 0x58534D42u;
constexpr std::array<u8, 4> CART_ROM_MAGIC_BYTES = { 0x42, 0x4d, 0x53, 0x58 };
constexpr size_t CART_ROM_METADATA_HEADER_SIZE = 72;
constexpr size_t CART_ROM_HEADER_SIZE = 84;
constexpr size_t CART_ROM_WORD_ALIGNMENT = 4;
constexpr u32 CART_VDP_CLASS_PSX = 1;
struct CartRomHeader {
	u32 headerSize = 0;
	u32 manifestOffset = 0;
	u32 manifestLength = 0;
	u32 tocOffset = 0;
	u32 tocLength = 0;
	u32 dataOffset = 0;
	u32 dataLength = 0;
	u32 blua32ImageOffset = 0;
	u32 blua32ImageByteCount = 0;
	u32 blua32StartupFunctionAddress = 0;
	u32 blua32IrqFunctionAddress = 0;
	u32 blua32ExceptionFunctionAddress = 0;
	u32 blua32StaticLayoutTokenLo = 0;
	u32 blua32StaticLayoutTokenHi = 0;
	u32 metadataOffset = 0;
	u32 metadataLength = 0;
	MachineVdpClass vdpClass = MachineVdpClass::Psx;
	u32 cartridgeBoardWord = 0;
	u32 cartridgeRamByteCount = 0;
};

void writeCartRomHeader(u8* data, const CartRomHeader& header);
CartRomHeader parseCartHeader(const u8* data, size_t size);

/* ============================================================================
 * Machine manifest (effective hardware spec)
 * ============================================================================ */

struct MachineManifest {
	std::string namespaceName;
	MachineVdpClass vdpClass = MachineVdpClass::Psx;
};

/* ============================================================================
 * Cart manifest (cartridge metadata)
 * ============================================================================ */

struct CartManifest {
	std::optional<std::string> title;
	std::optional<std::string> shortName;
	std::optional<std::string> romName;
	MachineManifest machine;
	std::string entryPath;
	u32 cartridgeBoardWord = 0;
	u32 cartridgeRamByteCount = 0;
};

} // namespace bmsx

#endif // BMSX_ROMPACK_H
