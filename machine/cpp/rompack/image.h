/*
 * image.h - Physical BMSX ROM image admission
 */

#ifndef BMSX_ROMPACK_IMAGE_H
#define BMSX_ROMPACK_IMAGE_H

#include "common/primitives.h"
#include "rompack/format.h"
#include <span>

namespace bmsx {

struct RomImage {
	std::span<const u8> bytes;
	CartRomHeader header;
};

RomImage parseRomImage(const u8* buffer, size_t size, RomImageDomain domain);

} // namespace bmsx

#endif // BMSX_ROMPACK_IMAGE_H
