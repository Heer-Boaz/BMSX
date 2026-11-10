#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/native_block_compiler.h"
#include "spec/blua32/cop0.h"

#include <algorithm>

#include "machine/cpu/execution_image.h"
#include "machine/common/numeric.h"

namespace bmsx {

std::unique_ptr<NativeBlock> NativeBlock::compile(
	std::span<const NativeBlockInstruction> instructions,
	const Value* constants,
	size_t& cacheBytes,
	Memory& memory,
	StringPool& strings,
	const NativeBlockExitHandlers& exitHandlers,
	u8 skippedInstructionWidth
) {
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock(cacheBytes));
	block->m_gate = &nativeBlockGate();
	bool controlGuarded = false;
	size_t slowCount = 0;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded);
		controlGuarded |= instruction.op == static_cast<u8>(OpCode::MFC0) || instruction.op == static_cast<u8>(OpCode::MTC0);
		slowCount += slow != NativeBlockExit::Continue;
	}
	const auto finalOp = static_cast<OpCode>(instructions.back().decoded->op);
	block->sideExits.reserve(slowCount + (finalOp == OpCode::JMPIF || finalOp == OpCode::JMPIFNOT
		|| nativeBlockComparison(static_cast<u8>(finalOp)) ? 1 : 0));
	auto& terminal = block->terminal;
	controlGuarded = false;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto op = static_cast<OpCode>(instruction.op);
		block->entryCycles = terminal.cycles + 1;
		terminal.cycles += instruction.baseCycles;
		block->sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		terminal.nextPc = op == OpCode::JMP ? instruction.bx : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		terminal.exitA = instruction.a; terminal.exitB = instruction.b; terminal.exitC = instruction.c;
		terminal.exitBx = instruction.bx;
		if (op == OpCode::SELF) terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 2);
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded);
		controlGuarded |= op == OpCode::MFC0 || op == OpCode::MTC0;
		if (slow != NativeBlockExit::Continue) {
			auto& exit = block->sideExits.emplace_back(terminal);
			exit.exit = slow;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (slow == NativeBlockExit::ReadField || slow == NativeBlockExit::WriteField
				|| slow == NativeBlockExit::ReadIndex || slow == NativeBlockExit::WriteIndex) {
				exit.tableCacheSlot = instruction.tableCacheSlot;
			} else if (slow == NativeBlockExit::ReadMemory || slow == NativeBlockExit::WriteMemory || slow == NativeBlockExit::WriteWords) {
				exit.displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D || op == OpCode::STORE_MEM_WORDS_D;
				exit.displacement = instruction.disp;
			}
		}
		// The checked exit owns this instruction's preflight and surcharge.
		// Later exits include the successful prefix, not a blocked attempt.
		if (slow == NativeBlockExit::WriteWords) terminal.cycles += ceilDiv4(instruction.c);
		if (op == OpCode::VARARG && instruction.b == 0) terminal.registerTop = 0;
		else if (op == OpCode::VARARG || op == OpCode::LOADNIL) {
			if (instruction.b != 0) terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + instruction.b);
		} else if (!nativeBlockEndsBlock(instruction.op, instruction.b) && slow != NativeBlockExit::WriteField && slow != NativeBlockExit::WriteMemory
			&& slow != NativeBlockExit::WriteWords
			&& slow != NativeBlockExit::WriteIndex && slow != NativeBlockExit::WriteInteger
			&& op != OpCode::MTC0 && op != OpCode::SETUP && op != OpCode::SETGL && op != OpCode::SETSYS) {
			terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 1);
		}
	}
	const auto op = static_cast<OpCode>(instructions.back().decoded->op);
	switch (op) {
		case OpCode::HALT: terminal.exit = NativeBlockExit::Halt; break;
		case OpCode::CALL: terminal.exit = NativeBlockExit::Call; break;
		case OpCode::RET: terminal.exit = NativeBlockExit::Return; break;
		case OpCode::NEWT: terminal.exit = NativeBlockExit::AllocateTable; break;
		case OpCode::CONCAT: terminal.exit = NativeBlockExit::Concat; break;
		case OpCode::CONCATN: terminal.exit = NativeBlockExit::ConcatRange; break;
		case OpCode::CLOSURE: terminal.exit = NativeBlockExit::CreateClosure; break;
		case OpCode::MTC0: terminal.exit = instructions.back().decoded->b == COP0_EXEC
			? NativeBlockExit::ExecuteFunction : instructions.back().decoded->b == COP0_STATUS
			? NativeBlockExit::ControlBoundary : NativeBlockExit::Continue; break;
		case OpCode::RFE: terminal.exit = NativeBlockExit::ExceptionReturn; break;
		default: terminal.exit = NativeBlockExit::Continue; break;
	}
	terminal.handler = exitHandlers[static_cast<size_t>(terminal.exit)];
	const NativeBlockExitSite* taken = nullptr;
	if (op == OpCode::JMPIF || op == OpCode::JMPIFNOT || nativeBlockComparison(static_cast<u8>(op))) {
		auto& exit = block->sideExits.emplace_back(terminal);
		if (nativeBlockComparison(static_cast<u8>(op))) {
			exit.exit = skippedInstructionWidth == 0 ? NativeBlockExit::SkipInstruction : NativeBlockExit::Continue;
			exit.nextPc += static_cast<u32>(skippedInstructionWidth) * INSTRUCTION_BYTES;
			block->sourceWords += skippedInstructionWidth;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
		}
		else exit.nextPc = instructions.back().decoded->bx;
		taken = &exit;
	}
	NativeBlockCompiler compiler(constants, block.get(), memory, strings, instructions);
	size_t slow = 0;
	for (const auto& source : instructions) {
		const auto* exit = slow < slowCount && block->sideExits[slow].currentPc == source.pc ? &block->sideExits[slow++] : nullptr;
		compiler.emit(*source.decoded, exit, taken);
	}
	block->m_code = compiler.finish(block->codeBytes, block->m_body);
	cacheBytes += block->codeBytes;
	return block;
}

NativeBlock::~NativeBlock() {
	terminal.link.disconnect();
	for (auto& exit : sideExits) exit.link.disconnect();
	while (m_incoming) m_incoming->disconnect();
	if (m_code) sljit_free_code(m_code, nullptr);
	m_cacheBytes -= codeBytes;
}

const NativeBlockExitSite* NativeBlock::run(NativeBlockRunState& state) const {
	using Entry = const NativeBlockExitSite* (SLJIT_FUNC *)(NativeBlockRunState*, void*);
	state.exitCode = m_gate->exit;
	return reinterpret_cast<Entry>(m_gate->entry)(&state, m_body);
}

void NativeBlock::execute(NativeCpuRunState& state) const {
	using Entry = void (SLJIT_FUNC *)(NativeCpuRunState*, void*);
	state.state.exitCode = m_gate->dispatch;
	reinterpret_cast<Entry>(m_gate->entry)(&state, m_body);
}

void NativeBlockLink::disconnect() {
	if (!target) return;
	if (previous) previous->next = next;
	else target->m_incoming = next;
	if (next) next->previous = previous;
	target = nullptr;
	code = nullptr;
	previous = next = nullptr;
}

void NativeBlock::linkFrom(const NativeBlockExitSite& source) {
	auto& link = source.link;
	link.disconnect();
	link.code = m_body;
	link.cycles = entryCycles;
	link.target = this;
	link.next = m_incoming;
	if (m_incoming) m_incoming->previous = &link;
	m_incoming = &link;
}

} // namespace bmsx
