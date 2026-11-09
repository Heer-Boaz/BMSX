#include "machine/cpu/cpu.h"

#include <algorithm>
#include <array>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/memory/memory.h"

namespace bmsx {

bool CPU::runNativeBlock(CallFrame& frame, DecodedInstructionPage& page, u32 word) {
	constexpr size_t maximumCodeBytes = 4u * 1024u * 1024u;
	constexpr u8 compilationThreshold = 8;
	constexpr size_t maximumInstructions = 64;
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	if (!page.nativeBlocks->entries[word]) {
		u8& visits = page.nativeBlocks->visits[word];
		if (visits >= compilationThreshold) return false;
		if (++visits < compilationThreshold) return false;
		if (m_nativeCodeBytes >= maximumCodeBytes) {
			// Guest code is unaffected by eviction; only executable host cache is retired.
			for (auto& image : m_executionImagesByDomain) {
				if (!image) continue;
				for (auto& [key, decodedPage] : image->decodedPages) decodedPage.nativeBlocks.reset();
			}
			page.nativeBlocks = std::make_unique<NativeBlockPage>();
			page.nativeBlocks->visits[word] = compilationThreshold;
		}
		MappedPageBinding binding;
		m_memory.bindMappedPage(frame.pc & ~MAPPED_PAGE_BYTE_MASK, m_executionBusSignals, binding);
		if (!binding.readBytes) return false;
		std::array<NativeBlockInstruction, maximumInstructions> instructions;
		size_t count = 0;
		u32 cursor = word;
		u32 pc = frame.pc;
		while (cursor < DECODED_PAGE_WORDS - 1u && count < instructions.size()) {
			if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
				&& !decodeInstruction(frame, page, cursor, pc, false)) return false;
			const auto& instruction = page.words[cursor];
			if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
				|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
				|| !nativeBlockSupports(instruction.op)) break;
			instructions[count++] = {&instruction, pc};
			if (static_cast<OpCode>(instruction.op) == OpCode::JMP) break;
			cursor += instruction.width;
			pc += static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		}
		if (count < 2u) return false;
		page.nativeBlocks->entries[word] = NativeBlock::compile(
			std::span(instructions.data(), count), frame.executionImage->constPool.data(), m_nativeCodeBytes);
	}
	const auto& block = *page.nativeBlocks->entries[word];
	if (instructionBudgetRemaining < block.cycles) return false;
	block.run(frame.registers, frame.executionImage->constPool.data());
	instructionBudgetRemaining -= block.cycles;
	frame.pc = block.nextPc;
	frame.top = std::max(frame.top, block.registerTop);
	m_currentInstructionPc = block.currentPc;
	m_lastExecutionDomainId = frame.executionImage->executionDomainId;
	lastPc = block.lastPc;
	return true;
}

} // namespace bmsx
