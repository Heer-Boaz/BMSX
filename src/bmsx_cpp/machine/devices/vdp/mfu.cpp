#include "machine/devices/vdp/mfu.h"

#include <cstddef>

namespace bmsx {

void VdpMfuUnit::reset() {
	for (size_t index = 0u; index < VDP_MFU_WEIGHT_COUNT; ++index) {
		weightWords[index] = 0u;
	}
}

} // namespace bmsx
