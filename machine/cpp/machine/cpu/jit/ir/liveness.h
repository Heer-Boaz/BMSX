#pragma once

#include <bit>
#include <span>
#include <vector>

#include "common/types.h"

namespace bmsx {

struct NativeInstruction;
struct NativeIrBlock;

enum class NativeOperandDemand : u8 { None, Tag, Value };

// Entry liveness and next-use distances are derived from logical guest slots,
// without reference to the host register bank or code-emission state.
class NativeRegisterUses {
public:
	void analyze(std::span<const NativeIrBlock> blocks);

	bool entryReads(size_t block, int guest) const;

	template<class Visit> void forEachEntryRead(size_t block, Visit&& visit) const {
		const size_t base = block * m_liveWordCount;
		for (size_t word = 0; word < m_liveWordCount; ++word) {
			for (u64 live = m_entryLive[base + word]; live != 0; live &= live - 1) {
				const size_t index = 64 * word + std::countr_zero(live);
				visit(m_entryRegisters[index]);
			}
		}
	}

	void beginBlock(std::span<const NativeInstruction> instructions);
	int nextUse(size_t nextInstruction, int guest) const;
	NativeOperandDemand nextOperandDemand(size_t nextInstruction, int guest) const;

private:
	struct UseBoundary {
		int guest;
		u64 instructions;
	};

	std::vector<int> m_entryRegisters;
	std::vector<u64> m_entryLive;
	std::vector<u64> m_localLive;
	size_t m_liveWordCount = 0;
	std::vector<UseBoundary> m_nextUses;
	std::span<const NativeInstruction> m_instructions;
};

} // namespace bmsx
