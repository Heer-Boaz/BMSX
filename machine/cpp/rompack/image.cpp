#include "rompack/image.h"

#include "spec/bmsx/memory_map.h"

namespace bmsx {

RomImage parseRomImage(const u8* buffer, size_t size, RomImageDomain domain) {
	const size_t capacity = domain == RomImageDomain::System ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	if (size > capacity) {
		throw BMSX_RUNTIME_ERROR(
			domain == RomImageDomain::System
				? "System ROM payload exceeds its address window."
				: "Cartridge ROM payload exceeds its address window.");
	}
	return RomImage{std::span<const u8>(buffer, size), parseCartHeader(buffer, size)};
}

} // namespace bmsx
