#include "machine/cpu/jit/ir/liveness.h"

#include <algorithm>
#include <array>
#include <bit>
#include <limits>

#include "machine/cpu/jit/ir/region.h"

namespace bmsx {
void NativeRegisterUses::analyze(std::span<const NativeIrBlock> blocks) {
	m_entryRegisters.clear();
	bool hasForwardEdge = false;

	size_t maxBlockLength = 0;
	for (size_t i = 0; i < blocks.size(); ++i) {
		const auto& block = blocks[i];
		const auto [fallthrough, alternate] = block.successors;
		hasForwardEdge |= (fallthrough > i && fallthrough < blocks.size())
			|| (alternate > i && alternate < blocks.size());

		maxBlockLength = std::max(maxBlockLength, block.instructions.size());
	}
	if (maxBlockLength > 1) m_nextUses.reserve(maxBlockLength * 8);
	if (!hasForwardEdge) {
		m_liveWordCount = 0;
		m_entryLive.clear();
		return;
	}

	for (const auto& block : blocks)
		for (const auto& inst : block.instructions) {
			const auto& access = inst.slots;
			for (int guest : access.reads)
				if (guest >= 0) m_entryRegisters.push_back(guest);
			// Only individually produced payloads can occupy a host binding.
			// Include them when their next access is inside an open range.
			if (access.writes.count == 1) m_entryRegisters.push_back(access.writes.first);
		}
	std::sort(m_entryRegisters.begin(), m_entryRegisters.end());
	m_entryRegisters.erase(std::unique(m_entryRegisters.begin(), m_entryRegisters.end()), m_entryRegisters.end());

	// Index only slots that might be live. One wide register selector does not
	// make every intervening slot participate in the fixed point.
	m_liveWordCount = (m_entryRegisters.size() + 63u) / 64u;
	m_entryLive.assign(blocks.size() * m_liveWordCount, 0);
	if (m_liveWordCount == 0)
		return;
	m_localLive.assign(m_entryLive.size() * 2u, 0);
	const auto uses = std::span(m_localLive).first(m_entryLive.size());
	const auto definitions = std::span(m_localLive).last(m_entryLive.size());
	for (size_t i = 0; i < blocks.size(); ++i) {
		const size_t base = i * m_liveWordCount;
		for (const auto& inst : blocks[i].instructions) {
			const auto& access = inst.slots;
			for (int guest : access.reads) {
				if (guest < 0) continue;
				const size_t reg = std::lower_bound(m_entryRegisters.begin(), m_entryRegisters.end(), guest)
					- m_entryRegisters.begin();
				const size_t word = base + reg / 64u;
				uses[word] |= (u64{1} << (reg % 64u)) & ~definitions[word];
			}
			const auto markRange = [&](NativeSlotRange range, bool write) {
				const int end = range.end();
				for (auto reg = std::lower_bound(m_entryRegisters.begin(), m_entryRegisters.end(), static_cast<int>(range.first));
					reg != m_entryRegisters.end() && *reg < end; ++reg) {
					const size_t index = reg - m_entryRegisters.begin(), word = base + index / 64u;
					const u64 bit = u64{1} << (index % 64u);
					if (write) definitions[word] |= bit;
					else uses[word] |= bit & ~definitions[word];
				}
			};
			if (access.readsRange.count != 0 || access.readsRange.open) markRange(access.readsRange, false);
			// A guard miss leaves ITERN's result range untouched.
			if (access.writes.count != 0 && !access.writes.open
				&& !std::holds_alternative<NativeTableIterator>(inst.operation)) markRange(access.writes, true);
		}
	}

	bool changed;
	do {
		changed = false;
		for (size_t i = blocks.size(); i-- > 0;) {
			const auto& block = blocks[i];
			for (size_t word = 0; word < m_liveWordCount; ++word) {
				u64 liveOut = 0;
				for (const size_t successor : block.successors)
					if (successor != blocks.size())
						liveOut |= m_entryLive[successor * m_liveWordCount + word];
				const size_t slot = i * m_liveWordCount + word;
				const u64 live = uses[slot] | (liveOut & ~definitions[slot]);
				changed |= m_entryLive[slot] != live;
				m_entryLive[slot] = live;
			}
		}
	} while (changed);
}

bool NativeRegisterUses::entryReads(size_t block, int guest) const {
	const auto found = std::lower_bound(m_entryRegisters.begin(), m_entryRegisters.end(), guest);
	if (found == m_entryRegisters.end() || *found != guest)
		return false;
	const size_t reg = found - m_entryRegisters.begin();
	return (m_entryLive[block * m_liveWordCount + reg / 64u] & (u64{1} << (reg % 64u))) != 0;
}

void NativeRegisterUses::beginBlock(std::span<const NativeInstruction> instructions) {
	static_assert(NATIVE_BLOCK_MAX_INSTRUCTIONS <= std::numeric_limits<u64>::digits);
	m_instructions = instructions;
	m_nextUses.clear();
	for (size_t i = 0; i < instructions.size(); ++i) {
		const auto& access = instructions[i].slots;
		const u64 position = u64{1} << i;
		// Normalize this instruction's reads and writes to disjoint intervals
		// before the sweep: an aliased input/output must not cancel its bit.
		std::array<NativeSlotRange, 5> ranges;
		size_t count = 0;
		const auto insert = [&](NativeSlotRange range) {
			size_t index = count++;
			while (index != 0 && range.first < ranges[index - 1].first) {
				ranges[index] = ranges[index - 1];
				--index;
			}
			ranges[index] = range;
		};
		for (const auto range : {access.readsRange, access.writes})
			if (range.count != 0 || range.open) insert(range);
		for (const int guest : access.reads)
			if (guest >= 0) insert({static_cast<u16>(guest), 1});
		if (count == 0) continue;
		int first = ranges[0].first, end = ranges[0].end();
		for (size_t range = 1; range < count; ++range) {
			if (static_cast<int>(ranges[range].first) <= end) {
				end = std::max(end, ranges[range].end());
			} else {
				m_nextUses.push_back({first, position});
				m_nextUses.push_back({end, position});
				first = ranges[range].first;
				end = ranges[range].end();
			}
		}
		m_nextUses.push_back({first, position});
		m_nextUses.push_back({end, position});
	}

	// Sweep disjoint register intervals in place. Adjacent slots with the same
	// access history share one boundary, even for a wide LOADNIL or word store.
	std::sort(m_nextUses.begin(), m_nextUses.end(),
		[](const UseBoundary& a, const UseBoundary& b) { return a.guest < b.guest; });
	size_t read = 0, write = 0;
	u64 active = 0;
	while (read < m_nextUses.size()) {
		const int guest = m_nextUses[read].guest;
		const u64 previous = active;
		do {
			active ^= m_nextUses[read++].instructions;
		} while (read < m_nextUses.size() && m_nextUses[read].guest == guest);
		if (active != previous)
			m_nextUses[write++] = {guest, active};
	}
	m_nextUses.resize(write);
}

int NativeRegisterUses::nextUse(size_t nextInstruction, int guest) const {
	if (nextInstruction >= m_instructions.size())
		return std::numeric_limits<int>::max();
	const auto after = std::upper_bound(m_nextUses.begin(), m_nextUses.end(), guest,
		[](int slot, const UseBoundary& boundary) { return slot < boundary.guest; });
	const u64 positions = after == m_nextUses.begin() ? 0 : (after - 1)->instructions >> nextInstruction;
	return positions != 0 ? std::countr_zero(positions) : std::numeric_limits<int>::max();
}

int NativeRegisterUses::nextRead(size_t nextInstruction, int guest) const {
	constexpr int never = std::numeric_limits<int>::max();
	const int distance = nextUse(nextInstruction, guest);
	if (distance == never) return never;
	const auto& access = m_instructions[nextInstruction + distance].slots;
	if (std::ranges::find(access.reads, guest) != access.reads.end()
		|| (guest >= static_cast<int>(access.readsRange.first) && guest < access.readsRange.end()))
		return distance;
	// A pure definition ends the old value's ordinary register uses. It
	// does not cancel the obligation to reconstruct it on an earlier exit.
	return never;
}

NativeOperandDemand NativeRegisterUses::nextOperandDemand(size_t nextInstruction, int guest) const {
	const int distance = nextUse(nextInstruction, guest);
	if (distance == std::numeric_limits<int>::max()) return NativeOperandDemand::None;
	const auto& row = m_instructions[nextInstruction + distance];
	const auto& reads = row.slots.reads;
	if (std::ranges::find(reads, guest) == reads.end()) return NativeOperandDemand::None;
	if (std::holds_alternative<NativeTruthBranch>(row.operation)) return NativeOperandDemand::Tag;
	if (const auto* op = std::get_if<NativeNot>(&row.operation))
		return op->sourceTruthy ? NativeOperandDemand::None : NativeOperandDemand::Tag;
	if (const auto* cmp = std::get_if<NativeComparison>(&row.operation)) {
		if (const auto* eq = std::get_if<NativeTaggedEquality>(&cmp->strategy); eq && eq->tag <= ValueTag::True)
			return guest == (eq->knownLeft ? cmp->right : cmp->left) ? NativeOperandDemand::Tag : NativeOperandDemand::None;
	}
	return NativeOperandDemand::Value;
}

} // namespace bmsx
