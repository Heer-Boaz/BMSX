#include "machine/cpu/execution_image.h"

#include <algorithm>

namespace bmsx {

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
size_t Blua32ExecutionImage::nativeExecutionDomainOffset() {
	return offsetof(Blua32ExecutionImage, executionDomainId);
}

size_t Blua32ExecutionImage::nativeRomCallBindingsOffset() {
	return offsetof(Blua32ExecutionImage, nativeRomCallBindings);
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
#endif

const std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> DECODED_DISPATCH_BASE_CYCLES = [] {
	std::array<uint8_t, DECODED_DISPATCH_OP_COUNT> cycles{};
	std::copy(BASE_CYCLES.begin(), BASE_CYCLES.end(), cycles.begin());
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedShlBxor)] = BASE_CYCLES[static_cast<size_t>(OpCode::SHL)];
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedAddShl)] = BASE_CYCLES[static_cast<size_t>(OpCode::ADD)];
	cycles[static_cast<size_t>(DecodedDispatchOp::FusedShrBxor)] = BASE_CYCLES[static_cast<size_t>(OpCode::SHR)];
	cycles[static_cast<size_t>(DecodedDispatchOp::ReservedMemory)] = BASE_CYCLES[static_cast<size_t>(OpCode::LOAD_MEM)];
	return cycles;
}();

} // namespace bmsx
