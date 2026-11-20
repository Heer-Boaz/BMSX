#include "machine/cpu/native_ir.h"

#include <algorithm>
#include "machine/cpu/execution_image.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

u32 operationImmediate(const DecodedInstruction& instruction) {
	switch (static_cast<OpCode>(instruction.op)) {
	case OpCode::LOAD_MEM_D: case OpCode::STORE_MEM_D: case OpCode::STORE_MEM_WORDS_D:
		return static_cast<u32>(instruction.disp) << 2u;
	case OpCode::KSMI:
		return static_cast<u32>(instruction.sbx);
	case OpCode::LOADK: case OpCode::GETGL: case OpCode::SETGL: case OpCode::GETSYS: case OpCode::SETSYS:
	case OpCode::CLOSURE: case OpCode::JMP: case OpCode::JMPIF: case OpCode::JMPIFNOT:
		return instruction.bx;
	default:
		return 0;
	}
}

} // namespace

// Identify a straight-line numeric use of a field without relying on feedback
// here: cold image preparation needs the same candidate before it can observe
// a receiver slot or a pair of numeric tags.
const DecodedInstruction* nativeNumericFieldConsumer(std::span<const NativeBlockInstruction> instructions) {
	const auto& read = *instructions.front().decoded;
	if (read.op != static_cast<u8>(OpCode::GETFIELD) || instructions.size() < 2) return nullptr;
	size_t arithmetic = 1;
	const auto& successor = *instructions[arithmetic].decoded;
	const auto next = static_cast<OpCode>(successor.op);
	// An independent operand load can separate the field and arithmetic.
	if (next == OpCode::GETGL || next == OpCode::GETSYS || next == OpCode::GETUP
		|| next == OpCode::K0 || next == OpCode::K1 || next == OpCode::KM1 || next == OpCode::KSMI || next == OpCode::LOADK) {
		if (instructions.size() < 3 || successor.a == read.a) return nullptr;
		++arithmetic;
	}
	const auto& compute = *instructions[arithmetic].decoded;
	const auto op = static_cast<OpCode>(compute.op);
	if (op != OpCode::ADD && op != OpCode::SUB && op != OpCode::MUL) return nullptr;
	return compute.b == read.a || compute.c == read.a ? &compute : nullptr;
}

std::optional<ValueTag> nativeGuardedFieldResult(std::span<const NativeBlockInstruction> instructions) {
	const auto& read = *instructions.front().decoded;
	if (read.op != static_cast<u8>(OpCode::GETFIELD) || read.tableCacheSlot < 0) return std::nullopt;
	const auto* compute = nativeNumericFieldConsumer(instructions);
	if (!compute) return std::nullopt;
	const auto observed = compute->nativeNumericTypes();
	const auto tag = compute->b == read.a ? observed.left : observed.right;
	if (observed.stable && tag != ValueTag::Nil) return tag;
	return std::nullopt;
}

NativeIrRegion::NativeIrRegion(std::span<const NativeBlockSource> sources, const NativeBlockExitHandlers& handlers, bool cpuOwned) {
	size_t instructionCount = 0;
	for (const auto& source : sources) instructionCount += source.instructions.size();
	m_instructions.reserve(instructionCount);
	m_blocks.reserve(sources.size());
	entries.reserve(sources.size());
	for (const auto& source : sources) translate(source, handlers, cpuOwned);

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

void NativeIrRegion::translate(const NativeBlockSource& source, const NativeBlockExitHandlers& exitHandlers, bool cpuOwned) {
	const auto instructions = source.instructions;
	const size_t first = m_instructions.size();
	const auto* skippedInstruction = source.skippedInstruction;
	const u8 skippedInstructionWidth = skippedInstruction ? skippedInstruction->width : 0;
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock());
	block->firstPc = instructions.front().pc;
	bool controlGuarded = false;
	size_t slowCount = 0;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded, instruction.c);
		controlGuarded |= instruction.op == static_cast<u8>(OpCode::MFC0) || instruction.op == static_cast<u8>(OpCode::MTC0);
		slowCount += slow != NativeBlockExit::Continue;
	}
	const auto& last = *instructions.back().decoded;
	const auto finalOp = static_cast<OpCode>(last.op);
	const bool inlineBuiltin = cpuOwned && finalOp == OpCode::CALL && last.b >= 1 && last.b <= 3 && static_cast<u32>(last.c) <= 2;
	block->hasFusedJump = nativeBlockComparison(static_cast<u8>(finalOp)) && skippedInstruction
		&& skippedInstruction->op == static_cast<u8>(OpCode::JMP) && skippedInstruction->a == 0
		&& skippedInstruction->dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe);
	block->sideExits.reserve(slowCount + (finalOp == OpCode::JMPIF || finalOp == OpCode::JMPIFNOT
		|| nativeBlockComparison(static_cast<u8>(finalOp)) ? 1 : 0) + (block->hasFusedJump ? 1 : 0) + (inlineBuiltin ? 1 : 0));
	auto& terminal = block->terminal;
	controlGuarded = false;
	size_t numericPrefix = 0;
	for (size_t index = 0; index < instructions.size(); ++index) {
		const auto& source = instructions[index];
		const NativeResumePoint before{source.pc, terminal.cycles, terminal.registerTop};
		if (source.pc != block->firstPc) block->admissionCycles = terminal.cycles;
		const auto& instruction = *source.decoded;
		const auto op = static_cast<OpCode>(instruction.op);
		terminal.cycles += instruction.baseCycles;
		block->sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		terminal.nextPc = op == OpCode::JMP ? instruction.bx : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		terminal.exitA = instruction.a; terminal.exitB = instruction.b; terminal.exitC = instruction.c;
		terminal.exitBx = operationImmediate(instruction);
		auto& ir = m_instructions.emplace_back(NativeInstruction{
			{op, instruction.a, instruction.b, instruction.c, terminal.exitBx}, before, nullptr, {}});
		if (op == OpCode::ADD || op == OpCode::SUB || op == OpCode::MUL) {
			const auto observed = instruction.nativeNumericTypes();
			const auto* next = index + 1 < instructions.size() ? instructions[index + 1].decoded : nullptr;
			auto& hint = ir.specialization.emplace<NativeArithmeticHint>();
			if (observed.stable && observed.left != ValueTag::Nil)
				hint.feedback = NativeArithmeticFeedback{observed.left, observed.right};
			hint.resultFeedsStore = next && next->op == static_cast<u8>(OpCode::SETFIELD) && next->c == instruction.a;
		} else if (op == OpCode::MFC0 || op == OpCode::MTC0) {
			ir.specialization.emplace<NativeControlAccess>(!controlGuarded);
		} else if (op == OpCode::GETFIELD && index + 1 < instructions.size()) {
			if (const auto result = nativeGuardedFieldResult(instructions.subspan(index)))
				ir.specialization.emplace<NativeFieldRead>(*result);
		}
		if (op == OpCode::SELF) terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 2);
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded, instruction.c);
		controlGuarded |= op == OpCode::MFC0 || op == OpCode::MTC0;
		if (slow == NativeBlockExit::InvalidOperand && op != OpCode::MOV) numericPrefix = index + 1;
		if (slow != NativeBlockExit::Continue) {
			auto& exit = block->sideExits.emplace_back(terminal);
			ir.slow = &exit;
			exit.exit = slow;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (slow == NativeBlockExit::ReadField || slow == NativeBlockExit::ReadIndex)
				std::construct_at(&exit.tableReadCache, TableStringReadCache{
					.receiverSlot = instruction.tableCacheSlot, .holderSlot = -1, .holderDepth = 0, .indexSlots = {-1, -1, -1}});
			else if (slow == NativeBlockExit::WriteField || slow == NativeBlockExit::WriteIndex)
				exit.tableStoreSlot = instruction.tableCacheSlot;
		}
		// The checked exit owns this instruction's preflight and surcharge.
		// Later exits include the successful prefix, not a blocked attempt.
		if (slow == NativeBlockExit::WriteWords) terminal.cycles += instruction.c;
		if (op == OpCode::LOADNIL) terminal.cycles += instruction.b;
		if (op == OpCode::VARARG && instruction.b != 0) terminal.cycles += instruction.b - 1;
		if (op == OpCode::VARARG && instruction.b == 0) terminal.registerTop = 0;
		else if (op == OpCode::VARARG || (op == OpCode::LOADNIL && instruction.b != 0)) {
			const int count = instruction.b - (op == OpCode::VARARG ? 1 : 0);
			if (count > 0) terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + count);
		} else if (!nativeBlockEndsBlock(instruction.op, instruction.b) && slow != NativeBlockExit::WriteField && slow != NativeBlockExit::WriteMemory
			&& slow != NativeBlockExit::WriteWords
			&& slow != NativeBlockExit::WriteIndex && slow != NativeBlockExit::WriteInteger
			&& op != OpCode::LOADNIL && op != OpCode::MTC0 && op != OpCode::SETUP && op != OpCode::SETGL && op != OpCode::SETSYS) {
			terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 1);
		}
	}
	const auto op = static_cast<OpCode>(instructions.back().decoded->op);
	switch (op) {
		case OpCode::HALT: terminal.exit = NativeBlockExit::Halt; break;
		case OpCode::CALL: terminal.exit = NativeBlockExit::Call; break;
		case OpCode::RET: terminal.exit = NativeBlockExit::Return; break;
		case OpCode::NEWT:
			terminal.exit = NativeBlockExit::AllocateTable;
			terminal.recordConstructor = nullptr;
			break;
		case OpCode::CONCAT: terminal.exit = NativeBlockExit::Concat; break;
		case OpCode::CONCATN: terminal.exit = NativeBlockExit::ConcatRange; break;
		case OpCode::CLOSURE: terminal.exit = NativeBlockExit::CreateClosure; break;
		case OpCode::MTC0: terminal.exit = instructions.back().decoded->b == COP0_EXEC
			? NativeBlockExit::WriteControl : instructions.back().decoded->b == COP0_STATUS
			? NativeBlockExit::ControlBoundary : NativeBlockExit::Continue; break;
		case OpCode::RFE: terminal.exit = NativeBlockExit::ExceptionReturn; break;
		default: terminal.exit = NativeBlockExit::Continue; break;
	}
	terminal.handler = exitHandlers[static_cast<size_t>(terminal.exit)];
	NativeBlockExitSite* taken = nullptr;
	NativeBlockExitSite* beforeFusedJump = nullptr;
	NativeBlockExitSite* completedCall = nullptr;
	if (inlineBuiltin) {
		completedCall = &block->sideExits.emplace_back(terminal);
		completedCall->exit = NativeBlockExit::CompletedCall;
		completedCall->cycles = completedCall->registerTop = 0;
	}
	if (op == OpCode::JMPIF || op == OpCode::JMPIFNOT || nativeBlockComparison(static_cast<u8>(op))) {
		if (block->hasFusedJump) {
			// A compare can exhaust its grant, including a string surcharge.
			// Retain its successor before constructing the fused JMP edge.
			beforeFusedJump = &block->sideExits.emplace_back(terminal);
		}
		auto& exit = block->sideExits.emplace_back(terminal);
		taken = &exit;
		if (nativeBlockComparison(static_cast<u8>(op))) {
			exit.exit = skippedInstructionWidth == 0 ? NativeBlockExit::SkipInstruction : NativeBlockExit::Continue;
			exit.nextPc += static_cast<u32>(skippedInstructionWidth) * INSTRUCTION_BYTES;
			block->sourceWords += skippedInstructionWidth;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (block->hasFusedJump) {
				terminal.cycles += skippedInstruction->baseCycles;
				terminal.currentPc = terminal.nextPc;
				terminal.lastPc = terminal.currentPc + (static_cast<u32>(skippedInstructionWidth) - 1u) * INSTRUCTION_BYTES;
				terminal.nextPc = skippedInstruction->bx;
				terminal.exitA = skippedInstruction->a;
				terminal.exitB = skippedInstruction->b;
				terminal.exitC = skippedInstruction->c;
				terminal.exitBx = skippedInstruction->bx;
			}
		}
		else exit.nextPc = instructions.back().decoded->bx;
	}
	m_blocks.push_back({std::span<NativeInstruction>(m_instructions).subspan(first, instructions.size()), taken, {}, beforeFusedJump, completedCall, numericPrefix});
	entries.push_back(std::move(block));
}


} // namespace bmsx
