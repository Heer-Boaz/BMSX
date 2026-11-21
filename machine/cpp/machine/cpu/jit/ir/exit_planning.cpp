#include "machine/cpu/jit/ir/region.h"

#include <algorithm>
#include "machine/cpu/decoded_instruction.h"
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
		return move.conversion == ValueMoveKind::Copy ? NativeExitPlan{} : NativeExitPlan{NativeBlockExit::InvalidOperand};
	}

	NativeExitPlan operator()(const NativeArithmetic&) const { return {NativeBlockExit::InvalidOperand}; }
	NativeExitPlan operator()(const NativePoolRead&) const { return {NativeBlockExit::InvalidConstant}; }
	NativeExitPlan operator()(const NativeLength& length) const { return {NativeBlockExit::Length, {.length = {length.result, length.source}}}; }

	NativeExitPlan operator()(const NativeVararg& placement) const {
		return {NativeBlockExit::Vararg, {.vararg = placement}};
	}

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		switch (access.mode) {
		case NativeControlMode::ReadFault:
			return {NativeBlockExit::ControlFault};
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero:
			return access.checkPrivilege ? NativeExitPlan{NativeBlockExit::ControlFault} : NativeExitPlan{};
		case NativeControlMode::WriteWord: case NativeControlMode::ConsumeWord: case NativeControlMode::WriteSemantic:
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		}
		BMSX_UNREACHABLE();
	}

	NativeExitPlan operator()(const NativeUpvalueAccess& access) const {
		if (access.access == NativeAccess::Read) return {};
		return {NativeBlockExit::WriteUpvalue, {.upvalue = {access.slot, access.capture}}};
	}

	NativeExitPlan operator()(const NativeGlobalAccess& access) const {
		if (access.access == NativeAccess::Read) return {};
		return {access.bank == NativeGlobalBank::System ? NativeBlockExit::WriteSystemGlobal : NativeBlockExit::WriteGlobal,
			{.global = {access.index, access.slot}}};
	}

	NativeExitPlan operator()(const NativeTableAccess& access) const {
		const bool write = access.mode == NativeTableMode::Write;
		const NativeExitOperands operands{.table = {access.value, access.receiver, access.key, access.resultTag}};
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
	NativeExitPlan operator()(const NativeHalt&) const { return {NativeHalt::terminalExit}; }
	NativeExitPlan operator()(const NativeExceptionReturn&) const { return {NativeExceptionReturn::terminalExit}; }
	NativeExitPlan operator()(const NativeCallSite& call) const { return {call.terminalExit, {.call = call}}; }
	NativeExitPlan operator()(const NativeReturnSite& ret) const { return {ret.terminalExit, {.returned = ret}}; }
	NativeExitPlan operator()(const NativeTableAllocation& table) const { return {table.terminalExit, {.allocation = table}}; }
	NativeExitPlan operator()(const NativeConcat& concat) const { return {concat.terminalExit, {.concat = concat}}; }
	NativeExitPlan operator()(const NativeConcatRange& concat) const { return {concat.terminalExit, {.concatRange = concat}}; }
	NativeExitPlan operator()(const NativeClosure& closure) const { return {closure.terminalExit, {.closure = closure}}; }

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		if (access.mode == NativeControlMode::WriteSemantic && access.field == COP0_EXEC)
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		if (access.mode == NativeControlMode::WriteWord && access.field == COP0_STATUS)
			return {NativeBlockExit::ControlBoundary};
		return {};
	}
};

} // namespace

void NativeIrRegion::buildBlock(const NativeBlockSource& source, std::span<NativeInstruction> operations,
	bool cpuOwned) {
	const auto instructions = source.instructions;
	const auto* skippedInstruction = source.skippedInstruction;
	const u8 skippedInstructionWidth = skippedInstruction ? skippedInstruction->width : 0;
	auto& block = m_blocks.emplace_back(NativeIrBlock{
		.instructions = operations, .firstPc = instructions.front().pc,
		.firstSideExit = static_cast<u16>(m_sideExits.size())});
	const auto appendExit = [&](const NativeIrExit& exit, NativeIrSideExit& id) -> NativeIrExit& {
		id = block.sideExitCount++;
		return m_sideExits.emplace_back(exit);
	};
	bool controlGuarded = false;
	bool reachesEnd = true;
	for (auto& instruction : operations) {
		auto& operation = instruction.operation;
		if (auto* control = std::get_if<NativeControlAccess>(&operation)) {
			control->checkPrivilege = !controlGuarded;
			controlGuarded = true;
		}
		reachesEnd &= nativeOperationFlow(operation) != NativeOperationFlow::LeavesNative;
	}
	const auto& final = operations.back().operation;
	const auto* call = std::get_if<NativeCallSite>(&final);
	const bool inlineBuiltin = reachesEnd && cpuOwned && call && static_cast<unsigned>(call->supplied) <= 2u
		&& call->requested <= 1;
	const bool comparison = std::holds_alternative<NativeComparison>(final);
	const auto* branch = std::get_if<NativeTruthBranch>(&final);
	block.hasFusedJump = comparison && skippedInstruction
		&& skippedInstruction->op == static_cast<u8>(OpCode::JMP) && skippedInstruction->a == 0
		&& skippedInstruction->dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe);
	auto& terminal = block.terminal;
	for (size_t index = 0; index < instructions.size(); ++index) {
		const auto& source = instructions[index];
		NativeResumePoint before{source.pc, terminal.cycles, terminal.registerTop};
		if (index != 0) before.completed = NativeResumePoint::CompletedInstruction{terminal.currentPc, terminal.lastPc};
		if (source.pc != block.firstPc) block.admissionCycles = terminal.cycles;
		const auto& instruction = *source.decoded;
		terminal.cycles += instruction.baseCycles;
		block.sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		auto& ir = operations[index];
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
		const auto* memory = std::get_if<NativeMemoryAccess>(&ir.operation);
		if (memory && memory->format == MemoryAccessKind::F64LE)
			terminal.cycles += F64_ACCESS_EXTRA_CYCLES;
		const auto* table = std::get_if<NativeTableAccess>(&ir.operation);
		if (table && table->mode == NativeTableMode::ReadMethod)
			terminal.registerTop = std::max(terminal.registerTop, ir.slots.writes.end());
		const auto [slow, operands] = std::visit(NativeCheckedExit{}, ir.operation);
		if (slow != NativeBlockExit::Continue) {
			auto& exit = appendExit(terminal, ir.slow);
			exit.exit = slow;
			exit.operands = operands;
			if (table) exit.tableSlotSeed = table->predictedSlot;
		}
		// The checked exit owns the start charge above. Per-slot and
		// per-word charges are applied here only for the fast completion.
		if (memory) terminal.cycles += memory->wordCount;
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
	if (inlineBuiltin) {
		auto& completedCall = appendExit(terminal, block.completedCall);
		completedCall.exit = NativeBlockExit::CompletedCall;
		completedCall.cycles = completedCall.registerTop = 0;
	}
	if (branch || comparison) {
		if (block.hasFusedJump) {
			// A compare can exhaust its grant, including a string surcharge.
			// Retain its successor before constructing the fused JMP edge.
			appendExit(terminal, block.beforeFusedJump);
		}
		auto& exit = appendExit(terminal, block.taken);
		if (comparison) {
			exit.exit = skippedInstructionWidth == 0 ? NativeBlockExit::SkipInstruction : NativeBlockExit::Continue;
			exit.nextPc += static_cast<u32>(skippedInstructionWidth) * INSTRUCTION_BYTES;
			block.sourceWords += skippedInstructionWidth;
			if (block.hasFusedJump) {
				terminal.cycles += skippedInstruction->baseCycles;
				terminal.currentPc = terminal.nextPc;
				terminal.lastPc = terminal.currentPc + (static_cast<u32>(skippedInstructionWidth) - 1u) * INSTRUCTION_BYTES;
				terminal.nextPc = skippedInstruction->bx;
			}
		}
		else exit.nextPc = branch->target;
	}
	block.nativeSuccessor = reachesEnd && terminal.exit == NativeBlockExit::Continue;
}

} // namespace bmsx
