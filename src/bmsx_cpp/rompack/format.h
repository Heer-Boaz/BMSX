/*
 * format.h - ROM pack utilities
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "common/primitives.h"
#include <optional>
#include <string>

namespace bmsx {

constexpr u32 CART_ROM_MAGIC = 0x58534D42u;
constexpr i32 BIOS_ATLAS_ID = 254;
constexpr const char* SYSTEM_SLOT_TEXTURE_KEY = "_system_slot";
constexpr const char* FRAMEBUFFER_TEXTURE_KEY = "_framebuffer_2d";
constexpr const char* FRAMEBUFFER_RENDER_TEXTURE_KEY = "_framebuffer_render_2d";
constexpr const char* VDP_PRIMARY_SLOT_TEXTURE_KEY = "_vdp_slot_primary";
constexpr const char* VDP_SECONDARY_SLOT_TEXTURE_KEY = "_vdp_slot_secondary";

std::string generateAtlasAssetId(i32 atlasId);

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

} // namespace bmsx

#endif // BMSX_ROMPACK_H
