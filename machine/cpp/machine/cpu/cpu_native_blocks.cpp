#include "machine/cpu/cpu.h"

#include <algorithm>
#include <array>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/memory/memory.h"

namespace bmsx {

void CPU::prepareNativeBlock(CallFrame& frame, DecodedInstructionPage& page, u32 word) {
	constexpr size_t maximumCodeBytes = 4u * 1024u * 1024u;
	constexpr size_t maximumInstructions = 64;
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	if (!page.nativeBlocks->entries[word]) {
		u8& visits = page.nativeBlocks->visits[word];
		if (visits >= NATIVE_BLOCK_COMPILATION_THRESHOLD) return;
		if (++visits < NATIVE_BLOCK_COMPILATION_THRESHOLD) return;
		if (m_nativeCodeBytes >= maximumCodeBytes) {
			// Guest code is unaffected by eviction; only executable host cache is retired.
			for (auto& image : m_executionImagesByDomain) {
				if (!image) continue;
				for (auto& [key, decodedPage] : image->decodedPages) decodedPage.retireNativeBlocks();
			}
			page.nativeBlocks = std::make_unique<NativeBlockPage>();
			page.nativeBlocks->visits[word] = NATIVE_BLOCK_COMPILATION_THRESHOLD;
		}
		MappedPageBinding binding;
		m_memory.bindMappedPage(frame.pc & ~MAPPED_PAGE_BYTE_MASK, m_executionBusSignals, binding);
		std::array<NativeBlockInstruction, maximumInstructions> instructions;
		size_t count = 0;
		u32 cursor = word;
		u32 pc = frame.pc;
		while (cursor < DECODED_PAGE_WORDS - 1u && count < instructions.size()) {
			if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u) {
				// A partial backing page can still supply already decoded words.
				// Only a fully backed page admits new speculative instruction reads.
				if (!binding.readBytes) break;
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
		if (count == 0u || (count == 1u && !nativeBlockEndsBlock(instructions[0].decoded->op))) return;
		page.nativeBlocks->entries[word] = NativeBlock::compile(
			std::span(instructions.data(), count), frame.executionImage->constPool.data(), m_nativeCodeBytes);
		page.words[word].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
		page.words[word].dispatchCycles = page.words[word].baseCycles;
		page.refreshState[word] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
	}
}

} // namespace bmsx
