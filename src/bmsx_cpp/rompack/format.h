/*
 * format.h - ROM pack utilities
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "core/primitives.h"
#include <string>

namespace bmsx {

constexpr i32 ENGINE_ATLAS_INDEX = 254;
constexpr const char* ENGINE_ATLAS_TEXTURE_KEY = "_atlas_engine";
constexpr const char* FRAMEBUFFER_TEXTURE_KEY = "_framebuffer_2d";
constexpr const char* FRAMEBUFFER_RENDER_TEXTURE_KEY = "_framebuffer_render_2d";
constexpr const char* ATLAS_PRIMARY_SLOT_ID = "_atlas_primary";
constexpr const char* ATLAS_SECONDARY_SLOT_ID = "_atlas_secondary";

std::string generateAtlasName(i32 atlasIndex);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
