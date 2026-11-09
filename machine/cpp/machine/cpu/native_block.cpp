#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_compiler.h"

#include <algorithm>

#include "machine/cpu/execution_image.h"

namespace bmsx {

std::unique_ptr<NativeBlock> NativeBlock::compile(
	std::span<const NativeBlockInstruction> instructions,
	const Value* constants,
	size_t& cacheBytes,
	Memory& memory,
	const NativeBlockExitHandlers& exitHandlers
) {
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock(cacheBytes));
	const size_t slowCount = std::count_if(instructions.begin(), instructions.end(), [](const auto& source) {
		return nativeBlockSlowExit(source.decoded->op) != NativeBlockExit::Continue;
	});
	const auto finalOp = static_cast<OpCode>(instructions.back().decoded->op);
	block->sideExits.reserve(slowCount + (finalOp == OpCode::JMPIF || finalOp == OpCode::JMPIFNOT ? 1 : 0));
	auto& terminal = block->terminal;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto op = static_cast<OpCode>(instruction.op);
		terminal.cycles += instruction.baseCycles;
		block->sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		terminal.nextPc = op == OpCode::JMP ? instruction.bx : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		terminal.exitA = instruction.a; terminal.exitB = instruction.b; terminal.exitC = instruction.c;
		const auto slow = nativeBlockSlowExit(instruction.op);
		if (slow != NativeBlockExit::Continue) {
			auto& exit = block->sideExits.emplace_back(terminal);
			exit.exit = slow;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (slow == NativeBlockExit::ReadField || slow == NativeBlockExit::WriteField) {
				exit.tableCacheSlot = instruction.tableCacheSlot;
			} else {
				exit.displaced = op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D;
				exit.displacement = instruction.disp;
			}
		}
		if (!nativeBlockEndsBlock(instruction.op) && slow != NativeBlockExit::WriteField && slow != NativeBlockExit::WriteMemory) {
			terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 1);
		}
	}
	const auto op = static_cast<OpCode>(instructions.back().decoded->op);
	terminal.exit = op == OpCode::HALT ? NativeBlockExit::Halt : op == OpCode::CALL ? NativeBlockExit::Call
		: op == OpCode::RET ? NativeBlockExit::Return : NativeBlockExit::Continue;
	terminal.handler = exitHandlers[static_cast<size_t>(terminal.exit)];
	const NativeBlockExitSite* taken = nullptr;
	if (op == OpCode::JMPIF || op == OpCode::JMPIFNOT) {
		auto& exit = block->sideExits.emplace_back(terminal);
		exit.nextPc = instructions.back().decoded->bx;
		taken = &exit;
	}
	NativeBlockCompiler compiler(constants, block.get(), memory, instructions);
	size_t slow = 0;
	for (const auto& source : instructions) {
		const auto* exit = nativeBlockSlowExit(source.decoded->op) != NativeBlockExit::Continue ? &block->sideExits[slow++] : nullptr;
		compiler.emit(*source.decoded, exit, taken);
	}
	block->m_code = compiler.finish(block->codeBytes);
	cacheBytes += block->codeBytes;
	return block;
}

NativeBlock::~NativeBlock() {
	if (m_code) sljit_free_code(m_code, nullptr);
	m_cacheBytes -= codeBytes;
}

const NativeBlockExitSite* NativeBlock::run(Value* registers, const Value* constants) const {
	using Entry = const NativeBlockExitSite* (SLJIT_FUNC *)(Value*, const Value*);
	return reinterpret_cast<Entry>(m_code)(registers, constants);
}

} // namespace bmsx
