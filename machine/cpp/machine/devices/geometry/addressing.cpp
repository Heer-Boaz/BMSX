#include "machine/devices/geometry/addressing.h"

namespace bmsx {

uint32_t geometryByteAddr(uint32_t base, uint64_t offset) {
	return static_cast<uint32_t>(static_cast<uint64_t>(base) + offset);
}

uint32_t geometryIndexedAddr(uint32_t base, uint32_t index, uint32_t stride) {
	return geometryByteAddr(base, static_cast<uint64_t>(index) * static_cast<uint64_t>(stride));
}

} // namespace bmsx
