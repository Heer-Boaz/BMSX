#include "machine/devices/vdp/jtu.h"

#include "machine/devices/vdp/matrix_words.h"

namespace bmsx {

VdpJtuUnit::VdpJtuUnit() {
	reset();
}

void VdpJtuUnit::reset() {
	for (u32 matrixIndex = 0u; matrixIndex < VDP_JTU_MATRIX_COUNT; ++matrixIndex) {
		setIdentityMatrixWordsAt(matrixWords, static_cast<size_t>(matrixIndex * VDP_JTU_MATRIX_WORDS));
	}
}

} // namespace bmsx
