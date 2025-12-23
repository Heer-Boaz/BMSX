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

std::string generateAtlasName(i32 atlasIndex);

} // namespace bmsx

#endif // BMSX_ROMPACK_H
