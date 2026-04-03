/*
 * rompack.h - ROM pack utilities
 *
 * Mirrors TypeScript rompack.ts atlas helpers.
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "../core/types.h"
#include <string>

namespace bmsx {

constexpr i32 ENGINE_ATLAS_INDEX = 254;
constexpr const char* ENGINE_ATLAS_TEXTURE_KEY = "_atlas_engine";
constexpr const char* FRAMEBUFFER_TEXTURE_KEY = "_framebuffer_2d";
constexpr const char* FRAMEBUFFER_RENDER_TEXTURE_KEY = "_framebuffer_render_2d";
constexpr const char* ATLAS_PRIMARY_SLOT_ID = "_atlas_primary";
constexpr const char* ATLAS_SECONDARY_SLOT_ID = "_atlas_secondary";
constexpr i32 SKYBOX_FACE_DEFAULT_SIZE = 512;
constexpr const char* SKYBOX_SLOT_POSX_ID = "_skybox_posx";
constexpr const char* SKYBOX_SLOT_NEGX_ID = "_skybox_negx";
constexpr const char* SKYBOX_SLOT_POSY_ID = "_skybox_posy";
constexpr const char* SKYBOX_SLOT_NEGY_ID = "_skybox_negy";
constexpr const char* SKYBOX_SLOT_POSZ_ID = "_skybox_posz";
constexpr const char* SKYBOX_SLOT_NEGZ_ID = "_skybox_negz";

std::string generateAtlasName(i32 atlasIndex);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
