#include "machine/cpu/execution_image.h"

#include <algorithm>

namespace bmsx {

const std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> DECODED_DISPATCH_BASE_CYCLES = [] {
	std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> cycles{};
	std::copy(BASE_CYCLES.begin(), BASE_CYCLES.end(), cycles.begin());
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedShlBxor)] = BASE_CYCLES[static_cast<size_t>(OpCode::SHL)];
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedAddShl)] = BASE_CYCLES[static_cast<size_t>(OpCode::ADD)];
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedShrBxor)] = BASE_CYCLES[static_cast<size_t>(OpCode::SHR)];
	return cycles;
}();

} // namespace bmsx
