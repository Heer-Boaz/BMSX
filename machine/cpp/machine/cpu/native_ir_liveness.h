#pragma once

#include <span>
#include <vector>

#include "common/types.h"

namespace bmsx {

struct NativeInstruction;
struct NativeIrBlock;

// Entry liveness and next-use distances are derived from logical guest slots,
// without reference to the host register bank or code-emission state.
class NativeRegisterUses {
public:
	void analyze(std::span<const NativeIrBlock> blocks);

	bool entryReads(size_t block, int guest) const;
	bool hasForwardMerge(size_t block) const { return m_forwardEdges[block] > 1; }

	void beginBlock(std::span<const NativeInstruction> instructions);
	int nextUse(size_t nextInstruction, int guest) const;

private:
	struct UseBoundary {
		int guest;
		u64 instructions;
	};

	std::vector<int> m_entryRegisters;
	std::vector<u64> m_entryLive;
	std::vector<u16> m_forwardEdges;
	size_t m_liveWordCount = 0;
	std::vector<UseBoundary> m_nextUses;
	size_t m_currentLength = 0;
};

} // namespace bmsx
