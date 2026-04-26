/*
 * format.h - ROM pack utilities
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "core/primitives.h"
#include <string>

namespace bmsx {

constexpr i32 BIOS_ATLAS_ID = 254;
constexpr const char* BIOS_TEXTPAGE_TEXTURE_KEY = "_textpage_engine";
constexpr const char* FRAMEBUFFER_TEXTURE_KEY = "_framebuffer_2d";
constexpr const char* FRAMEBUFFER_RENDER_TEXTURE_KEY = "_framebuffer_render_2d";
constexpr const char* TEXTPAGE_PRIMARY_SLOT_ID = "_textpage_primary";
constexpr const char* TEXTPAGE_SECONDARY_SLOT_ID = "_textpage_secondary";

std::string generateAtlasAssetId(i32 atlasId);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
