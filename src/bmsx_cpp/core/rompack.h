/*
 * rompack.h - ROM pack utilities
 *
 * Mirrors TypeScript rompack.ts atlas helpers.
 */

#ifndef BMSX_ROMPACK_H
#define BMSX_ROMPACK_H

#include "types.h"
#include <string>

namespace bmsx {

constexpr i32 ENGINE_ATLAS_INDEX = 254;
constexpr const char* ENGINE_ATLAS_TEXTURE_KEY = "_atlas_engine";

std::string generateAtlasName(i32 atlasIndex);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
