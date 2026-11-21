#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_exits.h"
#include "machine/cpu/native_ir_liveness.h"
#include "machine/cpu/native_ir_optimize.h"

#include <algorithm>
#include "machine/cpu/execution_image.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
NativeIrRegion::NativeIrRegion(std::span<const NativeBlockSource> sources, const NativeBlockExitHandlers& handlers, ConstValueSpan constants, bool cpuOwned) {
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	m_instructions.reserve(instructionCount);
	m_blocks.reserve(sources.size());
	entries.reserve(sources.size());
	for (const auto& source : sources) translate(source, handlers, constants, cpuOwned);

	const auto entryForPc = [&](u32 pc) {
		for (size_t index = 0; index < entries.size(); ++index)
			if (entries[index]->firstPc == pc) return index;
		return entries.size();
	};
	for (size_t index = entries.size(); index-- > 0;) {
		auto& entry = *entries[index];
		if (sources[index].fallthrough) entry.sourceWords += entries[index + 1]->sourceWords;
		const auto& primary = entry.terminal;
		const auto* alternate = m_blocks[index].taken;
		const bool resumes = primary.exit == NativeBlockExit::Continue || primary.exit == NativeBlockExit::Call
			|| nativeBlockExitResumesFrame(primary.exit);
		m_blocks[index].successors = {
			resumes ? entryForPc(primary.nextPc) : entries.size(),
			alternate && alternate->exit == NativeBlockExit::Continue
				? entryForPc(alternate->nextPc) : entries.size(),
		};
	}
}

void NativeIrRegion::optimize(ConstValueSpan constants, NativeRegisterUses& uses) {
	uses.analyze(m_blocks);
	NativeTypePropagation{}.specializeRegion(m_blocks, constants, uses, m_entryTypes);
}

void NativeIrRegion::translate(const NativeBlockSource& source, const NativeBlockExitHandlers& exitHandlers, ConstValueSpan constants, bool cpuOwned) {
	const auto instructions = source.instructions;
	const size_t first = m_instructions.size();
	const auto* skippedInstruction = source.skippedInstruction;
	const u8 skippedInstructionWidth = skippedInstruction ? skippedInstruction->width : 0;
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock());
	block->firstPc = instructions.front().pc;
	bool controlGuarded = false;
	std::array<NativeExitPlan, NATIVE_BLOCK_MAX_INSTRUCTIONS> checks;
	size_t slowCount = 0;
	for (size_t index = 0; index < instructions.size(); ++index) {
		const auto operation = translateNativeOperation(instructions.subspan(index), constants, controlGuarded);
		controlGuarded |= std::holds_alternative<NativeControlAccess>(operation);
		auto& ir = m_instructions.emplace_back(operation);
		checks[index] = std::visit(NativeCheckedExit{}, ir.operation);
		slowCount += checks[index].kind != NativeBlockExit::Continue;
	}
	const auto& final = m_instructions.back().operation;
	const auto* call = std::get_if<NativeCallSite>(&final);
	const bool inlineBuiltin = cpuOwned && call && static_cast<unsigned>(call->supplied) <= 2u
		&& call->requested <= 1;
	const bool comparison = std::holds_alternative<NativeComparison>(final);
	const auto* branch = std::get_if<NativeTruthBranch>(&final);
	block->hasFusedJump = comparison && skippedInstruction
		&& skippedInstruction->op == static_cast<u8>(OpCode::JMP) && skippedInstruction->a == 0
		&& skippedInstruction->dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe);
	block->sideExits.reserve(slowCount + (branch || comparison ? 1 : 0)
		+ (block->hasFusedJump ? 1 : 0) + (inlineBuiltin ? 1 : 0));
	auto& terminal = block->terminal;
	size_t optimizationPrefix = 0;
	for (size_t index = 0; index < instructions.size(); ++index) {
		const auto& source = instructions[index];
		const NativeResumePoint before{source.pc, terminal.cycles, terminal.registerTop};
		if (source.pc != block->firstPc) block->admissionCycles = terminal.cycles;
		const auto& instruction = *source.decoded;
		terminal.cycles += instruction.baseCycles;
		block->sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		auto& ir = m_instructions[first + index];
		ir.before = before;
		const auto* jump = std::get_if<NativeJump>(&ir.operation);
		terminal.nextPc = jump ? jump->target : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		switch (static_cast<OpCode>(instruction.op)) {
		case OpCode::NEWT: ir.attempt = NativeAttempt::NewTable; break;
		case OpCode::CALL: ir.attempt = NativeAttempt::Call; break;
		case OpCode::SETFIELD: ir.attempt = NativeAttempt::AssignField; break;
		case OpCode::CONCAT: ir.attempt = NativeAttempt::Concat; break;
		case OpCode::CONCATN: ir.attempt = NativeAttempt::ConcatRange; break;
		default: break;
		}
#endif
		const auto* table = std::get_if<NativeTableAccess>(&ir.operation);
		if (table && table->mode == NativeTableMode::ReadMethod)
			terminal.registerTop = std::max(terminal.registerTop, ir.slots.writes.end());
		if (std::holds_alternative<NativeArithmetic>(ir.operation) || std::holds_alternative<NativeComparison>(ir.operation))
			optimizationPrefix = index + 1;
		const auto [slow, operands] = checks[index];
		if (slow != NativeBlockExit::Continue) {
			auto& exit = block->sideExits.emplace_back(terminal);
			ir.slow = &exit;
			exit.exit = slow;
			exit.operands = operands;
			exit.handler = exitHandlers[static_cast<size_t>(slow)];
			if (slow == NativeBlockExit::ReadField || slow == NativeBlockExit::ReadIndex)
				std::construct_at(&exit.tableReadCache, TableStringReadCache{
					.receiverSlot = instruction.tableCacheSlot, .holderSlot = -1, .holderDepth = 0, .indexSlots = {-1, -1, -1}});
			else if (slow == NativeBlockExit::WriteField || slow == NativeBlockExit::WriteIndex)
				exit.tableStoreSlot = instruction.tableCacheSlot;
		}
		// A checked semantic exit receives the base-only charge above.
		// A successful prefix includes every statically placed slot.
		if (const auto* memory = std::get_if<NativeMemoryAccess>(&ir.operation))
			terminal.cycles += memory->wordCount;
		if (const auto* nils = std::get_if<NativeClearSlots>(&ir.operation))
			terminal.cycles += nils->count;
		if (const auto* vararg = std::get_if<NativeVararg>(&ir.operation)) {
			if (vararg->requested < 0)
				terminal.registerTop = 0; // The datapath supplies the exact dynamic top.
			else
				terminal.cycles += vararg->requested;
		}
		const auto& writes = ir.slots.writes;
		// A terminal semantic operation owns its own placement and any
		// register-window growth, rather than publishing speculative results.
		const bool placesResults = index + 1 != instructions.size()
			|| std::visit(NativeTerminalExit{}, ir.operation).kind == NativeBlockExit::Continue;
		if (placesResults && writes.count != 0 && !writes.open)
			terminal.registerTop = std::max(terminal.registerTop, writes.end());
	}
	const auto [kind, operands] = std::visit(NativeTerminalExit{}, final);
	terminal.exit = kind;
	terminal.operands = operands;
	if (kind == NativeBlockExit::AllocateTable)
		terminal.recordConstructor = nullptr;
	terminal.handler = exitHandlers[static_cast<size_t>(terminal.exit)];
	NativeBlockExitSite* taken = nullptr;
	NativeBlockExitSite* beforeFusedJump = nullptr;
	NativeBlockExitSite* completedCall = nullptr;
	if (inlineBuiltin) {
		completedCall = &block->sideExits.emplace_back(terminal);
		completedCall->exit = NativeBlockExit::CompletedCall;
		completedCall->cycles = completedCall->registerTop = 0;
	}
	if (branch || comparison) {
		if (block->hasFusedJump) {
			// A compare can exhaust its grant, including a string surcharge.
			// Retain its successor before constructing the fused JMP edge.
			beforeFusedJump = &block->sideExits.emplace_back(terminal);
		}
		auto& exit = block->sideExits.emplace_back(terminal);
		taken = &exit;
		if (comparison) {
			exit.exit = skippedInstructionWidth == 0 ? NativeBlockExit::SkipInstruction : NativeBlockExit::Continue;
			exit.nextPc += static_cast<u32>(skippedInstructionWidth) * INSTRUCTION_BYTES;
			block->sourceWords += skippedInstructionWidth;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (block->hasFusedJump) {
				terminal.cycles += skippedInstruction->baseCycles;
				terminal.currentPc = terminal.nextPc;
				terminal.lastPc = terminal.currentPc + (static_cast<u32>(skippedInstructionWidth) - 1u) * INSTRUCTION_BYTES;
				terminal.nextPc = skippedInstruction->bx;
			}
		}
		else exit.nextPc = branch->target;
	}
	m_blocks.push_back({std::span<NativeInstruction>(m_instructions).subspan(first, instructions.size()), taken, {}, beforeFusedJump, completedCall, optimizationPrefix, terminal.exit == NativeBlockExit::Continue});
	entries.push_back(std::move(block));
}


} // namespace bmsx
