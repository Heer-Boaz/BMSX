#include "machine/devices/geometry/addressing.h"

#include <limits>

namespace bmsx {

uint32_t geometryByteAddr(uint32_t base, uint64_t offset) {
	return static_cast<uint32_t>(static_cast<uint64_t>(base) + offset);
}

uint32_t geometryIndexedAddr(uint32_t base, uint32_t index, uint32_t stride) {
	return geometryByteAddr(base, static_cast<uint64_t>(index) * static_cast<uint64_t>(stride));
}

bool geometryByteSpanFits(uint32_t base, uint64_t offset, uint64_t byteLength) {
	const uint64_t addr = static_cast<uint64_t>(base) + offset;
	return addr <= std::numeric_limits<uint32_t>::max()
		&& addr + byteLength <= (static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 1ull);
}

bool geometryIndexedSpanFits(uint32_t base, uint32_t index, uint32_t stride, uint64_t byteLength) {
	return (stride == 0u || index <= (std::numeric_limits<uint32_t>::max() / stride))
		&& geometryByteSpanFits(base, static_cast<uint64_t>(index) * static_cast<uint64_t>(stride), byteLength);
}

} // namespace bmsx
