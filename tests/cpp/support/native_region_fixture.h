#pragma once

#include "machine/cpu/native_block.h"

namespace bmsx::test {

// The first ABI entry borrows its descriptor from the complete compilation.
// Keep sibling descriptors resident because emitted branches refer to them.
inline std::shared_ptr<NativeBlock> compileNative(
	std::span<const NativeBlockInstruction> instructions, ConstValueSpan constants,
	size_t& cacheBytes, Memory& memory, StringPool& strings, StringId indexKey
) {
	const std::array runs{NativeBlockSource{instructions}};
	auto blocks = std::make_shared<std::vector<std::unique_ptr<NativeBlock>>>(
		NativeBlock::compileRegion(runs, constants, NativeCodeBindings(memory, strings, indexKey)));
	auto* first = blocks->front().get();
	first->region->publish(cacheBytes);
	return {std::move(blocks), first};
}

} // namespace bmsx::test
