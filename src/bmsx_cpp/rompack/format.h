/*
 * format.h - ROM pack utilities
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "common/primitives.h"
#include <array>
#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace bmsx {

struct ProgramImage;

constexpr u32 CART_ROM_MAGIC = 0x58534D42u;
constexpr std::array<u8, 4> CART_ROM_MAGIC_BYTES = { 0x42, 0x4d, 0x53, 0x58 };
constexpr size_t CART_ROM_BASE_HEADER_SIZE = 32;
constexpr size_t CART_ROM_PROGRAM_HEADER_SIZE = 64;
constexpr size_t CART_ROM_HEADER_SIZE = 72;
constexpr i32 BIOS_ATLAS_ID = 254;
constexpr const char* SYSTEM_SLOT_TEXTURE_KEY = "_system_slot";
constexpr const char* FRAMEBUFFER_TEXTURE_KEY = "_framebuffer_2d";
constexpr const char* FRAMEBUFFER_RENDER_TEXTURE_KEY = "_framebuffer_render_2d";
constexpr const char* VDP_PRIMARY_SLOT_TEXTURE_KEY = "_vdp_slot_primary";
constexpr const char* VDP_SECONDARY_SLOT_TEXTURE_KEY = "_vdp_slot_secondary";

std::string generateAtlasAssetId(i32 atlasId);

struct CartRomHeader {
	u32 headerSize = 0;
	u32 manifestOffset = 0;
	u32 manifestLength = 0;
	u32 tocOffset = 0;
	u32 tocLength = 0;
	u32 dataOffset = 0;
	u32 dataLength = 0;
	u32 programBootVersion = 0;
	u32 programBootFlags = 0;
	u32 programEntryProtoIndex = 0;
	u32 programCodeByteCount = 0;
	u32 programConstPoolCount = 0;
	u32 programProtoCount = 0;
	u32 programReserved0 = 0;
	u32 programConstRelocCount = 0;
	u32 metadataOffset = 0;
	u32 metadataLength = 0;
};

bool hasCartHeader(const u8* data, size_t size);
CartRomHeader parseCartHeader(const u8* data, size_t size);

/* ============================================================================
 * Machine manifest (effective hardware spec)
 * ============================================================================ */

struct MachineManifest {
	std::string namespaceName;
	i32 viewportWidth = 0;
	i32 viewportHeight = 0;
	std::optional<i32> ramBytes;
	std::optional<i32> slotBytes;
	std::optional<i32> systemSlotBytes;
	std::optional<i32> stagingBytes;
	std::optional<i64> cpuHz;
	std::optional<i64> imgDecBytesPerSec;
	std::optional<i64> dmaBytesPerSecIso;
	std::optional<i64> dmaBytesPerSecBulk;
	std::optional<i64> vdpWorkUnitsPerSec;
	std::optional<i64> geoWorkUnitsPerSec;
	std::optional<i64> ufpsScaled;
};

/* ============================================================================
 * Cart manifest (cartridge metadata)
 * ============================================================================ */

struct CartManifest {
	std::string name;
	std::string title;
	std::string shortName;
	std::string romName;
	std::string version;
	std::string author;
	std::string description;
};

std::vector<u8> encodeCartManifest(const CartManifest& cart, const MachineManifest& machine);
std::vector<u8> encodeProgramCartRom(const CartManifest& cart, const MachineManifest& machine, const ProgramImage& program);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
