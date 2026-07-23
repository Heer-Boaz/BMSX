#include "common/endian.h"
#include "machine/memory/map.h"
#include "rompack/loader.h"

#include <algorithm>
#include <array>
#include <stdexcept>

int main() {
	std::array<bmsx::u8, bmsx::CART_ROM_HEADER_SIZE - 1u> truncated{};
	for (const size_t size : {size_t{32}, size_t{76}, truncated.size()}) {
		bool rejected = false;
		try {
			bmsx::parseCartHeader(truncated.data(), size);
		} catch (const std::runtime_error&) {
			rejected = true;
		}
		if (!rejected) {
			throw std::runtime_error("Truncated ROM header was accepted");
		}
	}

	std::array<bmsx::u8, bmsx::CART_ROM_HEADER_SIZE> unsupportedProgram{};
	std::copy(
		bmsx::CART_ROM_MAGIC_BYTES.begin(),
		bmsx::CART_ROM_MAGIC_BYTES.end(),
		unsupportedProgram.begin());
	bmsx::writeLE32(unsupportedProgram.data() + 4u, bmsx::CART_ROM_HEADER_SIZE);
	bmsx::writeLE32(unsupportedProgram.data() + 32u, bmsx::PROGRAM_BOOT_HEADER_VERSION + 1u);
	bmsx::writeLE32(unsupportedProgram.data() + 72u, bmsx::CART_VDP_CLASS_PSX);
	bool unsupportedRejected = false;
	try {
		bmsx::parseCartHeader(unsupportedProgram.data(), unsupportedProgram.size());
	} catch (const std::runtime_error&) {
		unsupportedRejected = true;
	}
	if (!unsupportedRejected) {
		throw std::runtime_error("Unsupported program boot version was accepted");
	}

	const bmsx::u8 payload = 0u;
	try {
		bmsx::parseRomImage(
			&payload,
			static_cast<size_t>(bmsx::CART_ROM_SIZE) + 1u,
			bmsx::RomImageDomain::Cartridge);
	} catch (const std::runtime_error&) {
		return 0;
	}
	throw std::runtime_error("ROM payload beyond the cartridge aperture was accepted");
}
