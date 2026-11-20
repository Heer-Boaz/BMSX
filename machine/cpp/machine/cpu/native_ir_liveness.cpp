#include "machine/cpu/native_ir_liveness.h"

#include <algorithm>
#include <array>
#include <bit>
#include <limits>

#include "machine/cpu/native_block.h"
#include "machine/cpu/native_ir.h"

namespace bmsx {
namespace {

struct RegisterAccess {
	std::array<int, 3> slots;
	u8 reads;
	bool writesA;
	int rangeEnd;
};

RegisterAccess registerAccess(const NativeOperands& op) {
	const auto code = static_cast<u8>(op.op);
	const int rangeCount = op.op == OpCode::LOADNIL ? op.b
		: (op.op == OpCode::STORE_MEM_WORDS || op.op == OpCode::STORE_MEM_WORDS_D) ? op.c : 0;
	return {{op.a, op.b, op.c}, OPCODE_SCALAR_REGISTER_READS[code], OPCODE_WRITES_REGISTER_A[code] != 0,
		op.a + rangeCount};
}

// The incoming map is useful only for a typed use before publication. Table
// lookups and frame/semantic operations do not justify imposing one edge's
// proved register types on other incoming edges.
bool propagatesEntryFacts(OpCode op) {
	switch (op) {
	case OpCode::MOV:
	case OpCode::LOADNIL:
	case OpCode::NOT:
	case OpCode::LOADK:
	case OpCode::LOADKR:
	case OpCode::GETUP:
	case OpCode::SETUP:
	case OpCode::LEN:
	case OpCode::MFC0:
	case OpCode::MTC0:
	case OpCode::LOAD_MEM:
	case OpCode::LOAD_MEM_D:
	case OpCode::STORE_MEM:
	case OpCode::STORE_MEM_D:
	case OpCode::KNIL:
	case OpCode::KFALSE:
	case OpCode::KTRUE:
	case OpCode::K0:
	case OpCode::K1:
	case OpCode::KM1:
	case OpCode::KSMI:
	case OpCode::ADD:
	case OpCode::SUB:
	case OpCode::MUL:
	case OpCode::DIV:
	case OpCode::MOD:
	case OpCode::FLOORDIV:
	case OpCode::POW:
	case OpCode::BAND:
	case OpCode::BOR:
	case OpCode::BXOR:
	case OpCode::SHL:
	case OpCode::SHR:
	case OpCode::BNOT:
	case OpCode::UNM:
	case OpCode::GETGL:
	case OpCode::SETGL:
	case OpCode::GETSYS:
	case OpCode::SETSYS:
	case OpCode::JMP:
	case OpCode::JMPIF:
	case OpCode::JMPIFNOT:
	case OpCode::EQ:
	case OpCode::LT:
	case OpCode::LE:
		return true;
	default:
		return false;
	}
}

} // namespace

void NativeRegisterUses::analyze(std::span<const NativeIrBlock> blocks) {
	m_entryRegisters.clear();
	m_forwardEdges.assign(blocks.size(), 0);

	size_t maxBlockLength = 0;
	for (size_t i = 0; i < blocks.size(); ++i) {
		const auto& block = blocks[i];
		const auto [fallthrough, alternate] = block.successors;
		if (fallthrough > i && fallthrough < blocks.size())
			++m_forwardEdges[fallthrough];
		if (alternate > i && alternate < blocks.size() && alternate != fallthrough)
			++m_forwardEdges[alternate];

		maxBlockLength = std::max(maxBlockLength, block.instructions.size());
	}
	if (maxBlockLength > 1) m_nextUses.reserve(maxBlockLength * 6);
	// A block can inherit an optimized entry map only from a single forward
	// predecessor. Standalone regions and all-merge regions need no live map.
	if (std::none_of(m_forwardEdges.begin(), m_forwardEdges.end(), [](u16 edges) { return edges == 1; })) {
		m_liveWordCount = 0;
		m_entryLive.clear();
		return;
	}

	std::vector<size_t> typedPrefix(blocks.size());
	for (size_t i = 0; i < blocks.size(); ++i) {
		for (const auto& inst : blocks[i].instructions) {
			if (!propagatesEntryFacts(inst.operands.op))
				break;
			++typedPrefix[i];
			const auto access = registerAccess(inst.operands);
			for (size_t operand = 0; operand < access.slots.size(); ++operand)
				if ((access.reads & (1u << operand)) && access.slots[operand] >= 0)
					m_entryRegisters.push_back(access.slots[operand]);
		}
	}
	std::sort(m_entryRegisters.begin(), m_entryRegisters.end());
	m_entryRegisters.erase(std::unique(m_entryRegisters.begin(), m_entryRegisters.end()), m_entryRegisters.end());

	// Index only slots that might be live. One wide register selector does not
	// make every intervening slot participate in the fixed point.
	m_liveWordCount = (m_entryRegisters.size() + 63u) / 64u;
	m_entryLive.assign(blocks.size() * m_liveWordCount, 0);
	if (m_liveWordCount == 0)
		return;
	std::vector<u64> local(m_entryLive.size() * 2u, 0);
	const auto uses = std::span(local).first(m_entryLive.size());
	const auto definitions = std::span(local).last(m_entryLive.size());
	for (size_t i = 0; i < blocks.size(); ++i) {
		const size_t base = i * m_liveWordCount;
		for (const auto& inst : blocks[i].instructions.first(typedPrefix[i])) {
			const auto access = registerAccess(inst.operands);
			for (size_t operand = 0; operand < access.slots.size(); ++operand) {
				const int guest = access.slots[operand];
				if ((access.reads & (1u << operand)) == 0 || guest < 0)
					continue;
				const size_t reg = std::lower_bound(m_entryRegisters.begin(), m_entryRegisters.end(), guest)
					- m_entryRegisters.begin();
				const size_t word = base + reg / 64u;
				uses[word] |= (u64{1} << (reg % 64u)) & ~definitions[word];
			}
			if (access.writesA || inst.operands.op == OpCode::LOADNIL) {
				const int first = access.slots[0];
				const int end = access.writesA ? first + 1 : access.rangeEnd;
				for (auto reg = std::lower_bound(m_entryRegisters.begin(), m_entryRegisters.end(), first);
					reg != m_entryRegisters.end() && *reg < end; ++reg) {
					const size_t index = reg - m_entryRegisters.begin();
					definitions[base + index / 64u] |= u64{1} << (index % 64u);
				}
			}
		}
	}

	bool changed;
	do {
		changed = false;
		for (size_t i = blocks.size(); i-- > 0;) {
			const auto& block = blocks[i];
			for (size_t word = 0; word < m_liveWordCount; ++word) {
				u64 liveOut = 0;
				if (typedPrefix[i] == block.instructions.size())
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
	m_currentLength = instructions.size();
	m_nextUses.clear();
	for (size_t i = 0; i < instructions.size(); ++i) {
		const auto access = registerAccess(instructions[i].operands);
		const u64 position = u64{1} << i;
		const int rangeFirst = access.slots[0];
		const auto add = [&](int first, int end) {
			m_nextUses.push_back({first, position});
			m_nextUses.push_back({end, position});
		};
		if (rangeFirst < access.rangeEnd)
			add(rangeFirst, access.rangeEnd);
		// Writes count as accesses: a cached destination can overwrite its
		// old dirty value directly instead of causing a spill before the write.
		const u8 slots = access.reads | (access.writesA ? REGISTER_OPERAND_A : 0);
		for (size_t operand = 0; operand < access.slots.size(); ++operand) {
			const int guest = access.slots[operand];
			if ((slots & (1u << operand)) == 0 || guest < 0 || (guest >= rangeFirst && guest < access.rangeEnd))
				continue;
			bool duplicate = false;
			for (size_t earlier = 0; earlier < operand; ++earlier)
				duplicate |= (slots & (1u << earlier)) && access.slots[earlier] == guest;
			if (!duplicate)
				add(guest, guest + 1);
		}
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
	if (nextInstruction >= m_currentLength)
		return std::numeric_limits<int>::max();
	const auto after = std::upper_bound(m_nextUses.begin(), m_nextUses.end(), guest,
		[](int slot, const UseBoundary& boundary) { return slot < boundary.guest; });
	const u64 positions = after == m_nextUses.begin() ? 0 : (after - 1)->instructions >> nextInstruction;
	return positions != 0 ? std::countr_zero(positions) : std::numeric_limits<int>::max();
}

} // namespace bmsx
