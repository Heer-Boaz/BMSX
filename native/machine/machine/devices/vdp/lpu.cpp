#include "machine/devices/vdp/lpu.h"

namespace bmsx {

void VdpLpuUnit::reset() {
	for (u32& word : registerWords) {
		word = 0u;
	}
}

} // namespace bmsx
