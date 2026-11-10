#include "machine/cpu/native_block_compiler.h"

#include <algorithm>

#include "machine/cpu/execution_image.h"

namespace bmsx {

void NativeBlockCompiler::planRegisterEntries(std::span<const NativeBlockSource> sources) {
	// Analyze only candidate scalar bindings. A counted range can touch these
	// bindings without allocating a matrix covering the entire WIDE register bank.
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	std::vector<int> candidates;
	candidates.reserve(instructionCount * 3u);
	for (const auto& source : sources) for (const auto& item : source.instructions) {
		const auto& op = *item.decoded;
		if ((op.op == static_cast<u8>(OpCode::STORE_MEM_WORDS) || op.op == static_cast<u8>(OpCode::STORE_MEM_WORDS_D)) && op.c == 0) continue;
		const auto operands = OPCODE_SCALAR_REGISTER_READS[op.op];
		if (operands & REGISTER_OPERAND_A) candidates.push_back(op.a);
		if ((operands & REGISTER_OPERAND_B) && op.b >= 0) candidates.push_back(op.b);
		if ((operands & REGISTER_OPERAND_C) && op.c >= 0) candidates.push_back(op.c);
	}
	std::sort(candidates.begin(), candidates.end());
	candidates.erase(std::unique(candidates.begin(), candidates.end()), candidates.end());
	const size_t words = (candidates.size() + 63u) / 64u;
	std::vector<u64> uses(sources.size() * words), defs(uses.size()), live(uses.size()), written(uses.size());
	struct ReadOrder {
		std::array<size_t, REGISTER_CACHE_CAPACITY> candidates;
		int count = 0;
	};
	std::vector<ReadOrder> localReads(sources.size());
	std::vector<std::array<size_t, 2>> successors(sources.size(), {sources.size(), sources.size()});
	for (size_t index = 0; index < sources.size(); ++index) {
		const auto first = index * words;
		const auto read = [&](size_t candidate) {
			const size_t word = candidate / 64u;
			const u64 bit = u64{1} << (candidate % 64u);
			if (((uses[first + word] | defs[first + word]) & bit) == 0) {
				uses[first + word] |= bit;
				auto& order = localReads[index];
				if (order.count < m_registerCount) order.candidates[order.count++] = candidate;
			}
		};
		const auto readScalar = [&](int guest) {
			if (guest >= 0) read(std::lower_bound(candidates.begin(), candidates.end(), guest) - candidates.begin());
		};
		const auto defineRange = [&](int guest, int end) {
			for (auto it = std::lower_bound(candidates.begin(), candidates.end(), guest); it != candidates.end() && *it < end; ++it) {
				const size_t candidate = it - candidates.begin(), word = candidate / 64u;
				const u64 bit = u64{1} << (candidate % 64u);
				defs[first + word] |= bit;
			}
		};
		for (const auto& item : sources[index].instructions) {
			const auto& op = *item.decoded;
			const auto kind = static_cast<OpCode>(op.op);
			if ((kind == OpCode::STORE_MEM_WORDS || kind == OpCode::STORE_MEM_WORDS_D) && op.c == 0) continue;
			const auto operands = OPCODE_SCALAR_REGISTER_READS[op.op];
			if (operands & REGISTER_OPERAND_A) readScalar(op.a);
			if (operands & REGISTER_OPERAND_B) readScalar(op.b);
			if (operands & REGISTER_OPERAND_C) readScalar(op.c);
			if (kind == OpCode::STORE_MEM_WORDS || kind == OpCode::STORE_MEM_WORDS_D) {
				for (auto it = std::lower_bound(candidates.begin(), candidates.end(), op.a);
					it != candidates.end() && *it < op.a + op.c; ++it) read(it - candidates.begin());
			}
			if (OPCODE_WRITES_REGISTER_A[op.op] && !nativeBlockEndsBlock(op.op, op.b)) defineRange(op.a, op.a + 1);
			if (kind == OpCode::SELF) defineRange(op.a + 1, op.a + 2);
			if (kind == OpCode::LOADNIL || (kind == OpCode::VARARG && op.b != 0)) defineRange(op.a, op.a + op.b);
			// Open VARARG may overwrite any suffix binding, but its runtime count
			// can be zero. It must not kill live-in values in the dataflow graph.
		}
		size_t successorCount = 0;
		const auto addSuccessor = [&](const NativeBlockExitSite& exit) {
			if (exit.exit != NativeBlockExit::Continue) return;
			for (size_t target = 0; target < m_blocks.size(); ++target) {
				if (m_blocks[target]->firstPc == exit.nextPc) {
					successors[index][successorCount++] = target;
					break;
				}
			}
		};
		if (sources[index].fallthrough) successors[index][successorCount++] = index + 1u;
		else addSuccessor(m_blocks[index]->terminal);
		for (const auto& exit : m_blocks[index]->sideExits) addSuccessor(exit);
	}
	bool changed;
	do {
		changed = false;
		for (size_t index = sources.size(); index-- > 0;) for (size_t word = 0; word < words; ++word) {
			u64 next = 0;
			for (auto target : successors[index]) if (target != sources.size()) next |= live[target * words + word];
			const size_t offset = index * words + word;
			const u64 value = uses[offset] | (next & ~defs[offset]);
			changed |= live[offset] != value;
			live[offset] = value;
		}
	} while (changed);
	// A binding starts dirty only if an internal predecessor can have written
	// it. A later definition in an unrelated branch must not dirty an entry.
	do {
		changed = false;
		for (size_t index = 0; index < sources.size(); ++index) for (auto target : successors[index]) {
			if (target == sources.size()) continue;
			for (size_t word = 0; word < words; ++word) {
				const size_t from = index * words + word, to = target * words + word;
				const u64 value = written[to] | written[from] | defs[from];
				changed |= written[to] != value;
				written[to] = value;
			}
		}
	} while (changed);
	for (size_t index = 0; index < sources.size(); ++index) {
		auto& registers = m_entries[index].registers;
		int count = 0;
		const auto admit = [&](size_t candidate) {
			if (count == m_registerCount) return;
			const int guest = candidates[candidate];
			for (int slot = 0; slot < count; ++slot) if (registers[slot].guest == guest) return;
			// Dirty is a conservative entry contract, not liveness-based state
			// elimination. Every dropped dirty binding is still published.
			registers[count] = {guest, (written[index * words + candidate / 64u] & (u64{1} << (candidate % 64u))) != 0,
				static_cast<u32>(m_registerCount - count)};
			++count;
		};
		for (int read = 0; read < localReads[index].count; ++read) admit(localReads[index].candidates[read]);
		for (size_t candidate = 0; candidate < candidates.size() && count < m_registerCount; ++candidate) {
			if (live[index * words + candidate / 64u] & (u64{1} << (candidate % 64u))) admit(candidate);
		}
		// Admission priority and physical placement are different decisions.
		// Equal live sets use equal maps even if their first-use order differs;
		// the saved ages still evict the furthest local input first.
		std::sort(registers.begin(), registers.begin() + count,
			[](const auto& left, const auto& right) { return left.guest < right.guest; });
	}
}

} // namespace bmsx
