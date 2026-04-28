#pragma once

#include <cstddef>
#include <cstdint>

namespace bmsx {

struct ImageCopyPlan {
	uint32_t baseAddr = 0;
	uint32_t writeWidth = 0;
	uint32_t writeHeight = 0;
	uint32_t writeStride = 0;
	uint32_t targetStride = 0;
	uint32_t sourceStride = 0;
	std::size_t writeLen = 0;
	bool clipped = false;
};

} // namespace bmsx
