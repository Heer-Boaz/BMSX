#include "rompack/tooling/blua32_symbols.h"
#include "spec/blua32/instruction_format.h"

#include <algorithm>

namespace bmsx {

auto blua32SlotLiveAtPc(std::span<const ProgramWordRange> ranges, u32 codeAddress, u32 pc) -> bool {
	const i32 word = static_cast<i32>((pc - codeAddress) / INSTRUCTION_BYTES);
	size_t low = 0, high = ranges.size();
	while (low < high) {
		const size_t middle = (low + high) >> 1;
		if (ranges[middle].end <= word) low = middle + 1;
		else high = middle;
	}
	return low < ranges.size() && ranges[low].start <= word;
}

auto blua32SourceRangeAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> const Blua32SourceRange& {
	const size_t wordIndex = static_cast<size_t>((pc - textAddress) / INSTRUCTION_BYTES);
	return symbols.metadata.debugRanges[wordIndex];
}

auto blua32InlineCallSitesAtPc(
	const Blua32SymbolsImage& symbols,
	u32 textAddress,
	u32 pc
) -> std::span<const Blua32InlineCallSite> {
	const size_t wordIndex = static_cast<size_t>((pc - textAddress) / INSTRUCTION_BYTES);
	const u32 chainId = symbols.metadata.debugInlineCallSiteChainIds[wordIndex];
	return *symbols.metadata.debugInlineCallSiteChains[chainId];
}

auto blua32FunctionDisplayNameById(
	const Blua32SymbolsImage& symbols,
	const std::string& functionId
) -> const std::string& {
	const auto function = std::find(
		symbols.metadata.functionIds.begin(),
		symbols.metadata.functionIds.end(),
		functionId
	);
	return symbols.metadata.functionDisplayNames[
		static_cast<size_t>(function - symbols.metadata.functionIds.begin())
	];
}

} // namespace bmsx
