#include "machine/cpu/native_block.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/native_block_compiler.h"
#include "spec/blua32/cop0.h"

#include <algorithm>
#if defined(BMSX_NATIVE_PERF_MAP)
#include <cstdio>
#include "machine/cpu/native_perf_map.h"
#endif

#include "machine/cpu/execution_image.h"
#include "machine/memory/memory.h"

namespace bmsx {

NativeCodeBindings::NativeCodeBindings(Memory& memory, StringPool& pool, StringId indexKey, CPU* cpu)
	: ramBytes(memory.ramByteCount()), ram(memory.ramData()), ramBusEnd(memory.ramBusEndAddress()),
	  ramWriteGroups(memory.ramWriteWatches().groupData()),
	  ramCodeWatchWords(memory.ramWriteWatches().codeWordMasks()),
	  cartridgeSelection(&memory.cartridgeController().selectionWord()),
	  cartridgeRom{memory.cartridgeController().romStorage(0), memory.cartridgeController().romStorage(1)},
	  systemRom(&memory.systemRomStorage()), strings(&pool), indexKey(indexKey), cpu(cpu) {}

void NativeCodeRegion::publish(size_t& cacheBytes) {
#if defined(BMSX_NATIVE_COMPILER_WORKER) && defined(SLJIT_CONFIG_ARM)
	// Emission flushed the worker's instruction stream. Synchronize the
	// executing core before any entry from this allocation becomes reachable.
	auto address = reinterpret_cast<sljit_uw>(m_code);
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	address &= ~sljit_uw{1}; // SLJIT's executable handle includes the Thumb bit.
#endif
	SLJIT_CACHE_FLUSH(reinterpret_cast<void*>(address), reinterpret_cast<void*>(address + codeBytes));
#endif
	m_cacheBytes = &cacheBytes;
	cacheBytes += codeBytes;
}

#if defined(BMSX_NATIVE_PERF_MAP)
void NativeCodeRegion::recordPerfMap(ExecutionDomainId domain, u32 slot, u32 firstPc) const {
	char symbol[96];
	std::snprintf(symbol, sizeof(symbol), "bmsx_native_region_domain%d_slot%u_pc%08x", domain, slot, firstPc);
	auto address = static_cast<std::uintptr_t>(SLJIT_FUNC_ADDR(m_code));
#if defined(SLJIT_CONFIG_ARM_THUMB2) && SLJIT_CONFIG_ARM_THUMB2
	address &= ~std::uintptr_t{1};
#endif
	const NativePerfMapRange range{address, codeBytes, symbol};
	recordNativePerfMap(std::span(&range, 1));
}
#endif

std::unique_ptr<NativeBlock> NativeBlock::compile(
	std::span<const NativeBlockInstruction> instructions, ConstValueSpan constants,
	size_t& cacheBytes, Memory& memory, StringPool& strings, StringId indexKey,
	const NativeBlockExitHandlers& exitHandlers, const DecodedInstruction* skippedInstruction
) {
	const std::array sources{NativeBlockSource{instructions, skippedInstruction}};
	auto blocks = compileRegion(sources, constants, NativeCodeBindings(memory, strings, indexKey), exitHandlers);
	blocks.front()->region->publish(cacheBytes);
	return std::move(blocks.front());
}

std::vector<std::unique_ptr<NativeBlock>> NativeBlock::compileRegion(
	std::span<const NativeBlockSource> sources, ConstValueSpan constants,
	const NativeCodeBindings& bindings, const NativeBlockExitHandlers& exitHandlers
) {
	auto region = std::make_shared<NativeCodeRegion>();
	region->ram = bindings.ram;
	std::vector<std::unique_ptr<NativeBlock>> blocks;
	blocks.reserve(sources.size());
	for (const auto& source : sources) {
		auto block = prepare(source, exitHandlers);
		block->region = region;
		blocks.push_back(std::move(block));
	}
	for (size_t index = sources.size(); index-- > 0u;) {
		if (sources[index].fallthrough) {
			blocks[index]->sourceWords += blocks[index + 1u]->sourceWords;
		}
	}
	NativeBlockCompiler compiler(constants, blocks, bindings, sources);
	for (size_t index = 0; index < sources.size(); ++index) {
		const auto& source = sources[index];
		auto& block = *blocks[index];
		compiler.beginBlock(index);
		size_t slow = 0;
		const bool branch = nativeBlockComparison(source.instructions.back().decoded->op)
			|| source.instructions.back().decoded->op == static_cast<u8>(OpCode::JMPIF)
			|| source.instructions.back().decoded->op == static_cast<u8>(OpCode::JMPIFNOT);
		const size_t slowCount = block.sideExits.size() - (branch ? 1u : 0u) - (block.hasFusedJump ? 1u : 0u);
		auto* taken = branch ? &block.sideExits.back() : nullptr;
		for (const auto& instruction : source.instructions) {
			auto* exit = slow < slowCount && block.sideExits[slow].currentPc == instruction.pc ? &block.sideExits[slow++] : nullptr;
			compiler.emit(*instruction.decoded, exit, taken);
		}
		compiler.endBlock();
	}
	region->m_code = compiler.finish(region->codeBytes);
	return blocks;
}

NativeCodeRegion::~NativeCodeRegion() {
	if (m_code) sljit_free_code(m_code, nullptr);
	if (m_cacheBytes) *m_cacheBytes -= codeBytes;
}

std::unique_ptr<NativeBlock> NativeBlock::prepare(const NativeBlockSource& source, const NativeBlockExitHandlers& exitHandlers) {
	const auto instructions = source.instructions;
	const auto* skippedInstruction = source.skippedInstruction;
	const u8 skippedInstructionWidth = skippedInstruction ? skippedInstruction->width : 0;
	auto block = std::unique_ptr<NativeBlock>(new NativeBlock());
	block->firstPc = instructions.front().pc;
	block->m_gate = &nativeBlockGate();
	bool controlGuarded = false;
	size_t slowCount = 0;
	for (const auto& source : instructions) {
		const auto& instruction = *source.decoded;
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded, instruction.c);
		controlGuarded |= instruction.op == static_cast<u8>(OpCode::MFC0) || instruction.op == static_cast<u8>(OpCode::MTC0);
		slowCount += slow != NativeBlockExit::Continue;
	}
	const auto finalOp = static_cast<OpCode>(instructions.back().decoded->op);
	block->hasFusedJump = nativeBlockComparison(static_cast<u8>(finalOp)) && skippedInstruction
		&& skippedInstruction->op == static_cast<u8>(OpCode::JMP)
		&& skippedInstruction->dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe);
	block->sideExits.reserve(slowCount + (finalOp == OpCode::JMPIF || finalOp == OpCode::JMPIFNOT
		|| nativeBlockComparison(static_cast<u8>(finalOp)) ? 1 : 0) + (block->hasFusedJump ? 1 : 0) + (finalOp == OpCode::CALL ? 1 : 0));
	auto& terminal = block->terminal;
	controlGuarded = false;
	for (const auto& source : instructions) {
		if (source.pc != block->firstPc) block->admissionCycles = terminal.cycles;
		const auto& instruction = *source.decoded;
		const auto op = static_cast<OpCode>(instruction.op);
		terminal.cycles += instruction.baseCycles;
		block->sourceWords += instruction.width;
		terminal.currentPc = source.pc;
		terminal.lastPc = source.pc + (static_cast<u32>(instruction.width) - 1u) * INSTRUCTION_BYTES;
		terminal.nextPc = op == OpCode::JMP ? instruction.bx : source.pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		terminal.exitA = instruction.a; terminal.exitB = instruction.b; terminal.exitC = instruction.c;
		terminal.exitBx = instruction.bx;
		if (op == OpCode::LOAD_MEM_D || op == OpCode::STORE_MEM_D || op == OpCode::STORE_MEM_WORDS_D)
			terminal.exitBx = static_cast<u32>(instruction.disp) << 2u;
		else if (op == OpCode::LOAD_MEM || op == OpCode::STORE_MEM || op == OpCode::STORE_MEM_WORDS)
			terminal.exitBx = 0;
		if (op == OpCode::SELF) terminal.registerTop = std::max(terminal.registerTop, static_cast<int>(instruction.a) + 2);
		const auto slow = nativeBlockSlowExit(instruction.op, instruction.b, controlGuarded, instruction.c);
		controlGuarded |= op == OpCode::MFC0 || op == OpCode::MTC0;
		if (slow != NativeBlockExit::Continue) {
			auto& exit = block->sideExits.emplace_back(terminal);
			exit.exit = slow;
			exit.handler = exitHandlers[static_cast<size_t>(exit.exit)];
			if (slow == NativeBlockExit::ReadField || slow == NativeBlockExit::WriteField
				|| slow == NativeBlockExit::ReadIndex || slow == NativeBlockExit::WriteIndex) {
				exit.tableCacheSlot = instruction.tableCacheSlot;
			}
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
		case OpCode::NEWT: terminal.exit = NativeBlockExit::AllocateTable; break;
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
	if (op == OpCode::JMPIF || op == OpCode::JMPIFNOT || nativeBlockComparison(static_cast<u8>(op))) {
		if (block->hasFusedJump) {
			// A compare can exhaust its grant, including a string surcharge.
			// Retain its successor before constructing the fused JMP edge.
			block->sideExits.push_back(terminal);
		}
		auto& exit = block->sideExits.emplace_back(terminal);
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
	return block;
}


NativeBlock::~NativeBlock() {
	terminal.link.disconnect();
	for (auto& exit : sideExits) exit.link.disconnect();
	while (m_incoming) m_incoming->disconnect();

}

const NativeBlockExitSite* NativeBlock::run(NativeBlockRunState& state) const {
	using Entry = const NativeBlockExitSite* (SLJIT_FUNC *)(NativeBlockRunState*, void*);
	state.exitCode = m_gate->exit;
	state.ram = region->ram;
	return reinterpret_cast<Entry>(m_gate->entry)(&state, m_body);
}

void NativeBlock::execute(NativeCpuRunState& state) const {
	using Entry = void (SLJIT_FUNC *)(NativeCpuRunState*, void*);
	state.state.exitCode = m_gate->dispatch;
	reinterpret_cast<Entry>(m_gate->entry)(&state, m_body);
}

void NativeBlockLink::disconnect() {
	if (!target) return;
	sljit_set_jump_addr(patchAddress, coldEntry, executableOffset);
	if (previous) previous->next = next;
	else target->m_incoming = next;
	if (next) next->previous = previous;
	target = nullptr;
	previous = next = nullptr;
}

void NativeBlock::linkFrom(const NativeBlockExitSite& source) {
	auto& link = source.link;
	link.disconnect();
	sljit_set_jump_addr(link.patchAddress, reinterpret_cast<sljit_uw>(m_linkEntry), link.executableOffset);
	link.target = this;
	link.next = m_incoming;
	if (m_incoming) m_incoming->previous = &link;
	m_incoming = &link;
}

} // namespace bmsx
