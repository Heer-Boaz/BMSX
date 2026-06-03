#include "machine/devices/geometry/addressing.h"

#include <limits>

namespace bmsx {

std::optional<uint32_t> resolveGeometryByteOffset(uint32_t base, uint64_t offset, uint64_t byteLength) {
	const uint64_t addr = static_cast<uint64_t>(base) + offset;
	if (addr > std::numeric_limits<uint32_t>::max()) {
		return std::nullopt;
	}
	const uint64_t end = addr + byteLength;
	if (end > (static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 1ull)) {
		return std::nullopt;
	}
	return static_cast<uint32_t>(addr);
}

std::optional<uint32_t> resolveGeometryIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint64_t byteLength) {
	return resolveGeometryByteOffset(base, static_cast<uint64_t>(index) * static_cast<uint64_t>(stride), byteLength);
}

} // namespace bmsx
