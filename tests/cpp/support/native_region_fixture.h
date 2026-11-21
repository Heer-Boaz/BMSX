#pragma once

#include "machine/cpu/native_compiler.h"

namespace bmsx::test {

// The first ABI entry borrows its descriptor from the complete compilation.
// Keep sibling descriptors resident because emitted branches refer to them.
inline std::shared_ptr<NativeBlock> compileNative(
	std::span<const NativeBlockInstruction> instructions,
	size_t& cacheBytes, Memory& memory, StringPool& strings
) {
	const std::array runs{NativeBlockSource{instructions}};
	auto blocks = std::make_shared<std::vector<std::unique_ptr<NativeBlock>>>(
		NativeCompiler::compile(runs, NativeCodeBindings(memory, strings)));
	auto* first = blocks->front().get();
	first->region->publish(cacheBytes);
	return {std::move(blocks), first};
}

} // namespace bmsx::test
