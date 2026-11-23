#pragma once

#include <vector>

#include "machine/cpu/jit/compilation_input.h"

namespace bmsx {

// Only actual contradictions occupy memory, independently of the layout
// prediction and the executable regions which consume this profile.
class NativeFieldProofFeedback {
public:
	bool contradict(u32 word, ValueTag tag);
	void forget(u32 word);
	void appendSnapshot(u32 pagePc, std::vector<NativeRejectedFieldProof>& rejected) const;

private:
	struct Site {
		u16 word;
		ValueTag tag;
		u8 misses;
	};
	static constexpr u8 RETIRE_AFTER = 3;
	std::vector<Site> m_sites;
};

} // namespace bmsx
