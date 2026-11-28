#include "machine/cpu/jit/ir/region.h"

#include <algorithm>
#include "machine/cpu/jit/source_policy.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

struct NativeExitPlan {
	NativeBlockExit kind = NativeBlockExit::Continue;
	NativeExitOperands operands{};
};

// Checked operations leave the completed prefix plus the instruction's base
// charge to the runtime. Describe the operands here, not in the SLJIT code.
struct NativeCheckedExit {
	NativeExitPlan operator()(const auto&) const { return {}; }

	NativeExitPlan operator()(const NativeMove& move) const {
		return (move.conversion == ValueMoveKind::FloatBits || move.conversion == ValueMoveKind::FloatFromBits)
			&& move.conversionCheck == NativeTagCheck::Dynamic
			? NativeExitPlan{NativeBlockExit::InvalidOperand} : NativeExitPlan{};
	}

	NativeExitPlan operator()(const NativeArithmetic& op) const {
		switch (std::get<NativeNumericPlan>(op.strategy).action) {
		case NativeNumericAction::Fault: BMSX_UNREACHABLE();
		case NativeNumericAction::Kernel: case NativeNumericAction::DynamicNumber: return {NativeBlockExit::InvalidOperand};
		case NativeNumericAction::Word: case NativeNumericAction::Float: return {};
		}
		BMSX_UNREACHABLE();
	}
	NativeExitPlan operator()(const NativePoolRead&) const { return {NativeBlockExit::InvalidConstant}; }
	NativeExitPlan operator()(const NativeLength& length) const { return {NativeBlockExit::Length, {.length = {length.result, length.source}}}; }

	NativeExitPlan operator()(const NativeVararg& placement) const {
		return placement.requested == 0 ? NativeExitPlan{} : NativeExitPlan{NativeBlockExit::Vararg, {.vararg = placement}};
	}

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		switch (access.mode) {
		case NativeControlMode::ReadFault:
			return {NativeBlockExit::ControlFault};
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero:
			return access.checkPrivilege ? NativeExitPlan{NativeBlockExit::ControlFault} : NativeExitPlan{};
		case NativeControlMode::WriteWord: case NativeControlMode::ConsumeWord:
			if (!access.checkPrivilege && access.operand == NativeWordSource::Integer) return {};
			[[fallthrough]];
		case NativeControlMode::WriteSemantic:
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		}
		BMSX_UNREACHABLE();
	}

	NativeExitPlan operator()(const NativeUpvalueAccess& access) const {
		return {access.access == NativeAccess::Read ? NativeBlockExit::ReadUpvalue : NativeBlockExit::WriteUpvalue,
			{.upvalue = {access.slot, access.capture}}};
	}

	NativeExitPlan operator()(const NativeGlobalAccess& access) const {
		if (access.access == NativeAccess::Read) return {};
		return {access.bank == NativeGlobalBank::System ? NativeBlockExit::WriteSystemGlobal : NativeBlockExit::WriteGlobal,
			{.global = {access.index, access.slot}}};
	}

	NativeExitPlan operator()(const NativeTableAccess& access) const {
		const bool write = access.mode == NativeTableMode::Write;
		NativeExitOperands operands{.table = {
			.value = access.value, .receiver = access.receiver, .key = access.key,
			.resultProof = access.resultTag, .sourcePc = 0u,
		}};
		if (write) operands.table.extraHashSlots = access.extraHashSlots;
		switch (access.keyKind) {
		case NativeTableKey::Field: return {write ? NativeBlockExit::WriteField : NativeBlockExit::ReadField, operands};
		case NativeTableKey::Value: return {write ? NativeBlockExit::WriteIndex : NativeBlockExit::ReadIndex, operands};
		case NativeTableKey::Integer: return {write ? NativeBlockExit::WriteInteger : NativeBlockExit::ReadInteger, operands};
		}
		BMSX_UNREACHABLE();
	}

	NativeExitPlan operator()(const NativeMemoryAccess& access) const {
		const NativeExitOperands operands{.memory = {access.displacement, access.slot, access.address, access.format, access.wordCount}};
		switch (access.mode) {
		case NativeMemoryMode::Load: return {NativeBlockExit::ReadMemory, operands};
		case NativeMemoryMode::Store: return {NativeBlockExit::WriteMemory, operands};
		case NativeMemoryMode::StoreWords: return {NativeBlockExit::WriteWords, operands};
		}
		BMSX_UNREACHABLE();
	}
};

struct NativeTerminalExit {
	NativeExitPlan operator()(const auto&) const { return {}; }
	NativeExitPlan operator()(const NativeRegisterJump& jump) const { return {jump.terminalExit, {.registerJump = jump}}; }
	NativeExitPlan operator()(const NativeHalt&) const { return {NativeHalt::terminalExit}; }
	NativeExitPlan operator()(const NativeSupervisorCall& call) const {
		return {call.terminalExit, {.supervisorCall = call}};
	}
	NativeExitPlan operator()(const NativeExceptionReturn&) const { return {NativeExceptionReturn::terminalExit}; }
	NativeExitPlan operator()(const NativeCallSite& call) const {
		return {call.terminalExit, {.call = call}};
	}
	NativeExitPlan operator()(const NativeTableIterator& iterator) const {
		return iterator.ownsSkip() ? NativeExitPlan{NativeBlockExit::Continue, {}} :
			NativeExitPlan{iterator.terminalExit, {.iterator = iterator}};
	}
	NativeExitPlan operator()(const NativeReturnSite& ret) const {
		return {ret.terminalExit, {.returned = ret}};
	}
	NativeExitPlan operator()(const NativeClosure& closure) const { return {closure.terminalExit, {.closure = closure}}; }

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		if (access.mode == NativeControlMode::WriteSemantic && cop0WriteRetiresControl(access.field))
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		return {};
	}
};

// The observable prefix before a guest instruction. The charge and top
// describe only the instructions that already completed.
struct NativeResumePoint {
	struct CompletedInstruction {
		u32 pc, lastWord;
	};
	u32 pc;
	int cycles, top;
	std::optional<CompletedInstruction> completed{};
};

NativeIrExit scalarReplay(const NativeResumePoint& before, std::optional<NativeArithmeticFeedback> arithmetic = {}) {
	NativeIrExit exit{
		.exit = NativeBlockExit::ScalarBoundary,
		.operands = {.replay = {before.completed.has_value(), arithmetic}},
		.cycles = before.cycles, .registerTop = before.top, .nextPc = before.pc,
	};
	if (before.completed) {
		exit.currentPc = before.completed->pc;
		exit.lastPc = before.completed->lastWord;
	}
	return exit;
}

} // namespace

void NativeIrRegion::buildBlock(const NativeBlockSource& source, std::span<NativeInstruction> operations,
		bool cpuOwned) {
	const auto instructions = source.instructions;
	const auto* skipped = source.skippedInstruction;
	auto& block = m_blocks.emplace_back(NativeIrBlock{
		.instructions = operations, .firstPc = instructions.front().pc});
	bool controlGuarded = false;
	for (size_t row = 0; row < operations.size(); ++row) {
		auto& instruction = operations[row];
		const auto& decoded = *instructions[row].decoded;
		instruction.pc = instructions[row].pc;
		instruction.width = decoded.width;
		instruction.baseCycles = decoded.baseCycles;
		block.sourceWords += decoded.width;
		if (auto* control = std::get_if<NativeControlAccess>(&instruction.operation)) {
			control->checkPrivilege = !controlGuarded;
			controlGuarded = true;
		}
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
		switch (static_cast<OpCode>(decoded.op)) {
		case OpCode::CALL: instruction.attempt = NativeAttempt::Call; break;
		case OpCode::SETFIELD: instruction.attempt = NativeAttempt::AssignField; break;
		default: break;
		}
#endif
	}
	const auto& last = operations.back();
	const auto& final = last.operation;
	const bool reachesEnd = nativeOperationFlow(final) != NativeOperationFlow::LeavesNative;
	const auto* call = std::get_if<NativeCallSite>(&final);
	block.inlineBuiltin = reachesEnd && cpuOwned && call
		&& static_cast<unsigned>(call->supplied) <= 2u && call->requested <= 1;
	if (std::holds_alternative<NativeComparison>(final) && skipped) {
		block.skippedWidth = skipped->width;
		block.sourceWords += skipped->width;
		block.hasFusedJump = nativeComparisonPairsJump(*skipped);
		if (block.hasFusedJump) block.fusedJumpCycles = skipped->baseCycles;
	} else if (auto* iterator = std::get_if<NativeTableIterator>(&operations.back().operation); iterator && skipped) {
		block.skippedWidth = iterator->skipWidth = skipped->width;
		block.sourceWords += skipped->width;
	}
	const auto [kind, operands] = std::visit(NativeTerminalExit{}, final);
	const auto* jump = std::get_if<NativeJump>(&final);
	block.terminal = {.exit = kind, .operands = operands,
		.nextPc = jump ? jump->target : block.hasFusedJump ? skipped->bx() : last.pc + u32{last.width} * INSTRUCTION_BYTES};
	block.nativeSuccessor = reachesEnd && kind == NativeBlockExit::Continue;
}

void NativeIrRegion::finalizeBlockExits(NativeIrBlock& block) {
	if (block.terminal.exit == NativeBlockExit::InvalidOperand) truncateOwnFieldAddresses(block);
	block.firstSideExit = static_cast<u16>(m_sideExits.size());
	const auto appendExit = [&](const NativeIrExit& exit, NativeIrSideExit& id) -> NativeIrExit& {
		if (m_sideExits.capacity() == 0) m_sideExits.reserve(m_instructions.size());
		id = block.sideExitCount++;
		return m_sideExits.emplace_back(exit);
	};
	// Timing is independent of the selected fast path. Materialize an exit
	// only for a path the specialized operation can take.
	NativeIrExit state;
	for (auto& instruction : block.instructions) {
		const u32 pc = instruction.pc;
		NativeResumePoint before{pc, state.cycles, state.registerTop};
		if (pc != block.firstPc) {
			before.completed = NativeResumePoint::CompletedInstruction{state.currentPc, state.lastPc};
			block.admissionCycles = state.cycles;
		}
		state.cycles += instruction.baseCycles;
		state.currentPc = pc;
		state.nextPc = pc + u32{instruction.width} * INSTRUCTION_BYTES;
		state.lastPc = state.nextPc - INSTRUCTION_BYTES;
		const auto* memory = std::get_if<NativeMemoryAccess>(&instruction.operation);
		if (memory && memory->format == MemoryAccessKind::F64LE)
			state.cycles += F64_ACCESS_EXTRA_CYCLES;
		const auto* table = std::get_if<NativeTableAccess>(&instruction.operation);
		if (table && table->mode == NativeTableMode::ReadMethod)
			state.registerTop = std::max(state.registerTop, instruction.slots.writes.end());
		const auto [slow, operands] = std::visit(NativeCheckedExit{}, instruction.operation);
		if (slow != NativeBlockExit::Continue) {
			auto& exit = appendExit(state, instruction.slow);
			exit.exit = slow;
			exit.operands = operands;
			if (table) {
				exit.tableSlotSeed = table->predictedSlot;
				if (table->reusePeerWord) {
					exit.operands.table.reusePeerWord = table->reusePeerWord;
					exit.operands.table.sourcePc = block.sourcePc;
				}
			}
		}
		auto* arithmetic = std::get_if<NativeArithmetic>(&instruction.operation);
		auto* numeric = arithmetic ? &std::get<NativeNumericPlan>(arithmetic->strategy) : nullptr;
		if (numeric) {
			auto& plan = *numeric;
			if (plan.guardLeft || plan.guardRight)
				appendExit(scalarReplay(before, std::exchange(plan.feedbackAssumption, {})), instruction.replay);
		} else if (const auto* cmp = std::get_if<NativeComparison>(&instruction.operation); cmp && cmp->operation != OpCode::EQ
				&& std::get<NativeComparisonStrategy>(cmp->strategy) == NativeComparisonStrategy::Kernel) {
			appendExit(scalarReplay(before), instruction.replay);
		} else if (std::holds_alternative<NativeReplay>(instruction.operation)) {
			appendExit(scalarReplay(before), instruction.replay);
		}
		// The checked exit owns the start charge above. Per-slot and
		// per-word charges are applied here only for fast completion.
		if (memory) state.cycles += memory->wordCount;
		if (const auto* nils = std::get_if<NativeClearSlots>(&instruction.operation))
			state.cycles += nils->count;
		if (const auto* vararg = std::get_if<NativeVararg>(&instruction.operation)) {
			if (vararg->requested < 0)
				state.registerTop = 0; // The datapath supplies the exact dynamic top.
			else
				state.cycles += vararg->requested;
		}
		const auto& writes = instruction.slots.writes;
		// A terminal semantic operation owns its result placement.
		const bool placesResults = &instruction != &block.instructions.back() || block.terminal.exit == NativeBlockExit::Continue;
		if (placesResults && writes.count != 0 && !writes.open
			&& !std::holds_alternative<NativeTableIterator>(instruction.operation))
			state.registerTop = std::max(state.registerTop, writes.end());
	}

	const auto& final = block.instructions.back().operation;
	if (block.inlineBuiltin) {
		if (std::get<NativeCallSite>(final).calleeCheck != NativeTagCheck::Rejected) {
			auto& completed = appendExit(state, block.completedCall);
			completed.exit = NativeBlockExit::CompletedCall;
			completed.cycles = completed.registerTop = 0;
		} else {
			block.successors[0] = m_blocks.size();
		}
	}
	if (std::holds_alternative<NativeComparison>(final)) {
		if (block.hasFusedJump) {
			// A compare can exhaust its grant, including a string surcharge.
			appendExit(state, block.beforeFusedJump);
		}
		auto& taken = appendExit(state, block.taken);
		taken.exit = block.skippedWidth == 0 ? NativeBlockExit::SkipInstruction : NativeBlockExit::Continue;
		taken.nextPc += u32{block.skippedWidth} * INSTRUCTION_BYTES;
		if (block.hasFusedJump) {
			state.cycles += block.fusedJumpCycles;
			state.currentPc = state.nextPc;
			state.lastPc = taken.nextPc - INSTRUCTION_BYTES;
		}
	} else if (const auto* branch = std::get_if<NativeTruthBranch>(&final)) {
		appendExit(state, block.taken).nextPc = branch->target;
	} else if (const auto* iterator = std::get_if<NativeTableIterator>(&final); iterator && iterator->ownsSkip()) {
		// A guard miss executes the untouched generic iterator path at the
		// following PC. A matching cursor places all results, even at end.
		auto& taken = appendExit(state, block.taken);
		taken.registerTop = std::max(taken.registerTop, static_cast<int>(iterator->first) + iterator->count);
		taken.cycles += iterator->count;
		taken.nextPc += u32{iterator->skipWidth} * INSTRUCTION_BYTES;
	}
	block.terminal.cycles = state.cycles;
	block.terminal.registerTop = state.registerTop;
	block.terminal.currentPc = state.currentPc;
	block.terminal.lastPc = state.lastPc;
}

void NativeIrRegion::planAdmissionReplays() {
	static_assert(3u * DECODED_PAGE_WORDS <= std::numeric_limits<NativeIrReplayId>::max());
	m_admissionReplays.reserve(m_blocks.size());
	const auto appendReplay = [&](const NativeResumePoint& point) {
		const auto id = static_cast<NativeIrReplayId>(m_admissionReplays.size());
		m_admissionReplays.push_back(scalarReplay(point));
		return id;
	};
	for (auto& block : m_blocks) {
		block.entryReplay = appendReplay({block.firstPc, 0, 0});
		const auto exits = sideExits(block);
		const auto& primary = block.completedCall ? exits[*block.completedCall] : block.terminal;
		for (size_t edge = 0; edge < block.successors.size(); ++edge) {
			const auto target = block.successors[edge];
			if (target == m_blocks.size()) continue;
			const auto& successor = m_blocks[target];
			if (successor.admissionCycles == 0 && (successor.entryTypes.empty() || block.provesEntryTo(target)))
				continue;
			const auto& completed = edge == 0 ? primary : exits[*block.taken];
			if (edge == 1 && target == block.successors[0]
				&& completed.currentPc == primary.currentPc && completed.lastPc == primary.lastPc) {
				block.edgeReplay[edge] = block.edgeReplay[0];
				continue;
			}
			block.edgeReplay[edge] = appendReplay({successor.firstPc, 0, 0,
				NativeResumePoint::CompletedInstruction{completed.currentPc, completed.lastPc}});
		}
	}
}

} // namespace bmsx
