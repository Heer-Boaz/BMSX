#include "machine/cpu/cpu.h"
#include "machine/cpu/jit/limits.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/jit/source.h"
#include "machine/cpu/jit/source_policy.h"

namespace bmsx {

void CPU::discoverNativeSource(Blua32ExecutionImage& image, NativeCompilationSource& source, std::vector<u32>* outgoing) {
	auto& page = source.page;
	const auto& binding = source.binding;
	const u32 pagePc = source.pagePc;
	auto& roots = source.roots;
	auto& available = source.available;
	const auto enqueue = [&](u32 pc, bool leader) { source.enqueue(pc, leader, outgoing); };
	for (; source.discoveredCount < source.pendingCount; ++source.discoveredCount) {
		const u32 cursor = source.pending[source.discoveredCount];
		const u32 pc = pagePc + cursor * INSTRUCTION_BYTES;
		// Existing entry points retain their region; an edge to one becomes an
		// ordinary external link. Interior entries compile a separate suffix.
		if (page.nativeBlocks && page.nativeBlocks->entries[cursor]) continue;
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u) {
			if (!decodeBackedInstruction(image, page, cursor, pc, source.busSignals)) continue;
		}
		const auto& instruction = page.words[cursor];
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
			|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
			|| !nativeSourceCanEmit(instruction, image.constPool.size())) continue;
		if (instruction.op >= static_cast<u8>(OpCode::GETSYS) && instruction.op <= static_cast<u8>(OpCode::SETGL)) {
			const auto& bank = instruction.op <= static_cast<u8>(OpCode::SETSYS) ? m_systemGlobalBank : m_globalBank;
			if (instruction.bx >= bank.capacity()) continue; // The general mirror port is scalar.
		}
		if (!roots[cursor] && binding.writeWatch.groups
			&& page.nativeVisits[cursor] + 1u < NATIVE_BLOCK_COMPILATION_THRESHOLD) continue;
		available[cursor] = 1;
		const auto op = static_cast<OpCode>(instruction.op);
		const u32 successor = cursor + instruction.width;
		const u32 successorPc = pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		if (nativeBlockComparison(instruction.op)) {
			if (binding.readBytes && successor < DECODED_PAGE_WORDS) {
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) != 0u && successor < DECODED_PAGE_WORDS - 1u
					&& !decodeBackedInstruction(image, page, successor, successorPc, source.busSignals)) continue;
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
					&& successor + page.words[successor].width <= DECODED_PAGE_WORDS) {
					enqueue(successorPc + static_cast<u32>(page.words[successor].width) * INSTRUCTION_BYTES, true);
					const auto& skipped = page.words[successor];
					if (skipped.op == static_cast<u8>(OpCode::JMP) && skipped.a == 0
						&& skipped.dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe)) {
						// This edge executes the fused JMP, not a separate entry.
						// An independent predecessor can still enqueue the JMP itself.
						enqueue(skipped.bx, true);
						continue;
					}
				}
			}
			enqueue(successorPc, true);
		} else if (op == OpCode::JMP || op == OpCode::JMPIF || op == OpCode::JMPIFNOT) {
			enqueue(instruction.bx, true);
			if (op != OpCode::JMP) enqueue(successorPc, true);
		} else if (!nativeBlockEndsBlock(instruction.op, instruction.b)) enqueue(successorPc, false);
		else if (nativeBlockHasTerminalContinuation(instruction.op, instruction.b)) enqueue(successorPc, true);
	}
}

} // namespace bmsx
