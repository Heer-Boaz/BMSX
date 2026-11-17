#include "machine/cpu/native_block_compiler.h"

#include <algorithm>
#include "machine/cpu/execution_image.h"

namespace bmsx {
namespace {
// A semantic exit publishes the whole cache and re-enters through a public
// entry. Only instructions actually retaining registers can pass live proofs
// to their native successor. This is compile-time control-flow analysis.
bool retainsRegisters(OpCode op) {
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

void NativeBlockCompiler::analyzeEntryLiveness() {
	int lastRegister = -1;
	for (const auto& source : m_sources)
		for (const auto& item : source.instructions) {
			const auto& instruction = *item.decoded;
			const auto reads = OPCODE_SCALAR_REGISTER_READS[instruction.op];
			if ((reads & REGISTER_OPERAND_A) || OPCODE_WRITES_REGISTER_A[instruction.op])
				lastRegister = std::max<int>(lastRegister, instruction.a);
			if (reads & REGISTER_OPERAND_B)
				lastRegister = std::max<int>(lastRegister, instruction.b);
			if (reads & REGISTER_OPERAND_C)
				lastRegister = std::max<int>(lastRegister, instruction.c);
			if (instruction.op == static_cast<u8>(OpCode::LOADNIL))
				lastRegister = std::max(lastRegister, instruction.a + instruction.b - 1);
		}
	m_liveWordCount = static_cast<size_t>(lastRegister + 64) / 64;
	m_entryLive.assign(m_sources.size() * m_liveWordCount, 0);
	std::vector<u64> uses(m_entryLive.size()), definitions(m_entryLive.size());
	std::vector<std::array<size_t, 2>> successors(m_sources.size(), {m_sources.size(), m_sources.size()});
	for (size_t index = 0; index < m_sources.size(); ++index) {
		const size_t base = index * m_liveWordCount;
		bool continuing = true;
		for (const auto& item : m_sources[index].instructions) {
			const auto& instruction = *item.decoded;
			const auto op = static_cast<OpCode>(instruction.op);
			if (!retainsRegisters(op)) {
				continuing = false;
				break;
			}
			const auto reads = OPCODE_SCALAR_REGISTER_READS[instruction.op];
			const std::array<int, 3> operands{instruction.a, instruction.b, instruction.c};
			for (size_t operand = 0; operand < operands.size(); ++operand) {
				const int guest = operands[operand];
				if ((reads & (1u << operand)) == 0 || guest < 0)
					continue;
				const size_t word = base + guest / 64;
				const u64 mask = u64{1} << (guest % 64);
				uses[word] |= mask & ~definitions[word];
			}
			if (op == OpCode::LOADNIL) {
				for (int guest = instruction.a; guest < instruction.a + instruction.b; ++guest)
					definitions[base + guest / 64] |= u64{1} << (guest % 64);
			} else if (OPCODE_WRITES_REGISTER_A[instruction.op])
				definitions[base + instruction.a / 64] |= u64{1} << (instruction.a % 64);
		}
		if (!continuing)
			continue;
		const auto& block = *m_blocks[index];
		if (block.terminal.exit == NativeBlockExit::Continue)
			successors[index][0] = regionEntryIndex(block.terminal.nextPc);
		const auto op = static_cast<OpCode>(m_sources[index].instructions.back().decoded->op);
		if (op == OpCode::JMPIF || op == OpCode::JMPIFNOT || nativeBlockComparison(static_cast<u8>(op))) {
			const auto& alternate = block.sideExits.back();
			if (alternate.exit == NativeBlockExit::Continue)
				successors[index][1] = regionEntryIndex(alternate.nextPc);
		}
	}
	bool changed;
	do {
		changed = false;
		for (size_t index = m_sources.size(); index-- > 0;)
			for (size_t word = 0; word < m_liveWordCount; ++word) {
				u64 liveOut = 0;
				for (const size_t successor : successors[index])
					if (successor != m_sources.size())
						liveOut |= m_entryLive[successor * m_liveWordCount + word];
				const size_t slot = index * m_liveWordCount + word;
				const u64 live = uses[slot] | (liveOut & ~definitions[slot]);
				changed |= live != m_entryLive[slot];
				m_entryLive[slot] = live;
			}
	} while (changed);
}

bool NativeBlockCompiler::entryReads(size_t entry, int guest) const {
	const size_t word = static_cast<size_t>(guest) / 64;
	return word < m_liveWordCount && (m_entryLive[entry * m_liveWordCount + word] & (u64{1} << (guest % 64))) != 0;
}

} // namespace bmsx
