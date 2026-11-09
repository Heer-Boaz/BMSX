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
		instructions[count++] = {&instruction, pc};
		if (nativeBlockEndsBlock(instruction.op)) break;
		cursor += instruction.width;
		pc += static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
	}
	if (count == 0u || (count == 1u && !nativeBlockEndsBlock(instructions[0].decoded->op))) {
		page.words[word].dispatchOp = page.words[word].op;
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
	const auto terminal = static_cast<OpCode>(instructions[count - 1u].decoded->op);
	const NativeBlockExitHandler handler = terminal == OpCode::CALL ? &CPU::compiledCallExit
		: terminal == OpCode::RET ? &CPU::compiledReturnExit : nullptr;
	page.nativeBlocks->entries[word] = NativeBlock::compile(
		std::span(instructions.data(), count), frame.executionImage->constPool.data(), m_nativeCodeBytes, handler);
	++page.nativeBlocks->count;
	page.words[word].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
	page.words[word].dispatchCycles = page.words[word].baseCycles;
	page.refreshState[word] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
}

} // namespace bmsx
