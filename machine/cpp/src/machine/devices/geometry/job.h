#pragma once

#include <cstdint>

namespace bmsx {

struct GeometryJobState {
	uint32_t cmd = 0;
	uint32_t src0 = 0;
	uint32_t src1 = 0;
	uint32_t src2 = 0;
	uint32_t dst0 = 0;
	uint32_t dst1 = 0;
	uint32_t count = 0;
	uint32_t param0 = 0;
	uint32_t param1 = 0;
	uint32_t stride0 = 0;
	uint32_t stride1 = 0;
	uint32_t stride2 = 0;
	uint32_t processed = 0;
	uint32_t resultCount = 0;
	uint32_t exactPairCount = 0;
	uint32_t broadphasePairCount = 0;
};

} // namespace bmsx
