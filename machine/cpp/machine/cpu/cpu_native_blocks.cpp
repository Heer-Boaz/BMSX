#include "machine/cpu/cpu.h"

#include <algorithm>
#include <array>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/memory/memory.h"

namespace bmsx {

void CPU::prepareNativeBlock(CallFrame& frame, DecodedInstructionPage& page, u32 word) {
	constexpr size_t maximumCodeBytes = 4u * 1024u * 1024u;
	MappedPageBinding binding;
	m_memory.bindMappedPage(m_currentInstructionPc & ~MAPPED_PAGE_BYTE_MASK, m_executionBusSignals, binding);
	std::array<NativeBlockInstruction, NATIVE_BLOCK_MAX_INSTRUCTIONS> instructions;
	size_t count = 0;
	u32 cursor = word;
	u32 pc = m_currentInstructionPc;
	bool warmingSuccessor = false;
	while (cursor < DECODED_PAGE_WORDS && count < instructions.size()) {
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u) {
			// A partial backing page can still supply already decoded words.
			// Only a fully backed page admits new speculative instruction reads.
			if (!binding.readBytes || cursor == DECODED_PAGE_WORDS - 1u) break;
			if (!decodeInstruction(frame, page, cursor, pc, false)) return;
		}
		const auto& instruction = page.words[cursor];
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
			|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
			|| !nativeBlockSupports(instruction.op)) break;
		if (count != 0u && binding.writeWatch.groups && page.nativeVisits[cursor] + 1u < NATIVE_BLOCK_COMPILATION_THRESHOLD) {
			// A repeatedly rewritten successor never becomes hot. Do not keep
			// compiling it into a stable predecessor only to retire that block.
			warmingSuccessor = true;
			break;
		}
		instructions[count++] = {&instruction, pc};
		if (nativeBlockEndsBlock(instruction.op)) break;
		cursor += instruction.width;
		pc += static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
	}
	if (count == 0u || (count == 1u && !nativeBlockEndsBlock(instructions[0].decoded->op))) {
		if (warmingSuccessor) page.nativeVisits[word] = 0;
		else page.words[word].dispatchOp = page.words[word].op;
		return;
	}
	if (m_nativeCodeBytes >= maximumCodeBytes) {
		// Guest code is unaffected by eviction; only executable host cache is retired.
		for (auto& image : m_executionImagesByDomain) {
			if (!image) continue;
			for (auto& [key, decodedPage] : image->decodedPages) decodedPage.retireNativeBlocks();
		}
	}
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	const NativeBlockExitHandlers handlers{nullptr, nullptr, &CPU::compiledCallExit, &CPU::compiledReturnExit,
		&CPU::compiledReadFieldExit, &CPU::compiledWriteFieldExit, &CPU::compiledReadMemoryExit, &CPU::compiledWriteMemoryExit};
	page.nativeBlocks->entries[word] = NativeBlock::compile(
		std::span(instructions.data(), count), frame.executionImage->constPool.data(), m_nativeCodeBytes, m_memory, handlers);
	++page.nativeBlocks->count;
	page.words[word].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
	page.words[word].dispatchCycles = page.words[word].baseCycles;
	page.refreshState[word] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
}

NativeBlockTransition CPU::compiledReadFieldExit(CPU* owner, CallFrame* activeFrame, const NativeBlockExitSite* exit) {
	auto& cpu = *owner;
	auto& frame = *activeFrame;
	frame.registers[exit->exitA] = cpu.loadTableFieldIndexCached(exit->tableCacheSlot,
		frame.registers[exit->exitB], asStringId(frame.executionImage->constPool[exit->exitC]));
	frame.top = std::max(frame.top, static_cast<int>(exit->exitA) + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteFieldExit(CPU* owner, CallFrame* activeFrame, const NativeBlockExitSite* exit) {
	auto& cpu = *owner;
	auto& frame = *activeFrame;
	cpu.storeTableFieldIndexCached(exit->tableCacheSlot, frame.registers[exit->exitA],
		asStringId(frame.executionImage->constPool[exit->exitB]), cpu.readRK(*frame.executionImage, frame.registers, exit->exitC));
	return NativeBlockTransition::NextInstruction;
}

} // namespace bmsx
