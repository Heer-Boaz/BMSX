#include "machine/cpu/jit/runtime/field_feedback.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/exit_contract.h"

namespace bmsx {

void CPU::observeNativeArithmeticReplay(DecodedInstructionPage& page, u32 word,
	NativeArithmeticFeedback assumption, Value left, Value right) {
	auto& decoded = page.words[word];
	decoded.observeNativeNumericTypes(left, right);
	const auto observed = decoded.nativeNumericTypes();
	if (observed.stable() && observed.left == assumption.left && observed.right == assumption.right) return;

	// A proven mixed site widens once for this decoded image. The generic
	// native operation remains usable through later runs of either pair.
	decoded.widenNativeNumericFeedback();
	retireNativeInstructionUsers(page, word);
}

void CPU::recompileNativeSource(CallFrame& frame, DecodedInstructionPage& page, u32 changedWord, u32 sourcePc) {
	retireNativeInstructionUsers(page, changedWord);
	prepareNativeBlock(frame, page, sourcePc, executionBusSignalsForDomain(frame.executionImage->executionDomainId));
}

bool NativeFieldProofFeedback::contradict(u32 word, ValueTag tag) {
	const auto sameWord = std::ranges::equal_range(m_sites, word, {}, &Site::word);
	const auto site = std::ranges::find(sameWord, tag, &Site::tag);
	if (site != sameWord.end()) return ++site->misses == RETIRE_AFTER;
	m_sites.insert(sameWord.end(), {static_cast<u16>(word), tag, 1});
	return false;
}

void NativeFieldProofFeedback::forget(u32 word) {
	const auto sites = std::ranges::equal_range(m_sites, word, {}, &Site::word);
	m_sites.erase(sites.begin(), sites.end());
}

void NativeFieldProofFeedback::appendSnapshot(u32 pagePc, std::vector<NativeRejectedFieldProof>& rejected) const {
	for (const auto& site : m_sites)
		if (site.misses == RETIRE_AFTER) rejected.push_back({pagePc + site.word * INSTRUCTION_BYTES, site.tag});
}

} // namespace bmsx
