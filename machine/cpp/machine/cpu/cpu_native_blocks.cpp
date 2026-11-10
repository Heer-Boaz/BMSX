#include "machine/cpu/cpu.h"

#include <algorithm>
#include <array>

#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_block.h"
#include "machine/memory/memory.h"

namespace bmsx {

void CPU::prepareNativeBlock(CallFrame& frame, DecodedInstructionPage& page, u32 word) {
	constexpr size_t maximumCodeBytes = 4u * 1024u * 1024u;
	if (m_nativeCodeBytes >= maximumCodeBytes) {
		for (auto& image : m_executionImagesByDomain) {
			if (!image) continue;
			for (auto& [key, decodedPage] : image->decodedPages) decodedPage.retireNativeBlocks();
		}
	}
	const u32 pagePc = m_currentInstructionPc & ~MAPPED_PAGE_BYTE_MASK;
	MappedPageBinding binding;
	m_memory.bindMappedPage(pagePc, m_executionBusSignals, binding);
	std::array<u8, DECODED_PAGE_WORDS> roots{}, queued{}, available{}, leaders{};
	std::array<u32, DECODED_PAGE_WORDS> pending{};
	std::array<const NativeCodeRegion*, DECODED_PAGE_WORDS> owners{};
	std::vector<const NativeCodeRegion*> merged;
	size_t pendingCount = 0;
	const auto enqueue = [&](u32 pc, bool leader) {
		const u32 offset = pc - pagePc;
		if (offset >= MAPPED_PAGE_BYTE_SIZE) return;
		const u32 next = offset / INSTRUCTION_BYTES;
		// Two sequential predecessors can meet after an external entry into
		// a WIDE body. That join also needs its own segment, not duplicate code.
		if (leader || queued[next]) leaders[next] = 1;
		if (!queued[next]) { queued[next] = 1; pending[pendingCount++] = next; }
	};
	roots[word] = 1;
	enqueue(m_currentInstructionPc, true);
	if (page.nativeBlocks) for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
		const auto& block = page.nativeBlocks->entries[entry];
		if (!block) continue;
		std::fill(owners.begin() + entry, owners.begin() + std::min(entry + block->sourceWords, static_cast<u32>(DECODED_PAGE_WORDS)), block->region.get());
	}
	for (size_t next = 0; next < pendingCount; ++next) {
		const u32 cursor = pending[next];
		const u32 pc = pagePc + cursor * INSTRUCTION_BYTES;
		if (const auto* region = owners[cursor]; region && std::find(merged.begin(), merged.end(), region) == merged.end()) {
			// Split a newly entered interior instruction in the same connected
			// region. Independent functions on the page retain their code owner.
			merged.push_back(region);
			leaders[cursor] = 1;
			for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
				const auto& block = page.nativeBlocks->entries[entry];
				if (!block || block->region.get() != region) continue;
				roots[entry] = 1;
				enqueue(pagePc + entry * INSTRUCTION_BYTES, true);
			}
		}
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u) {
			if (!binding.readBytes || cursor == DECODED_PAGE_WORDS - 1u) continue;
			if (!decodeInstruction(frame, page, cursor, pc, false)) return;
		}
		const auto& instruction = page.words[cursor];
		if ((page.refreshState[cursor] & DECODED_REFRESH_DECODE) != 0u
			|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
			|| !nativeBlockSupports(instruction.op)) continue;
		if (!roots[cursor] && binding.writeWatch.groups
			&& page.nativeVisits[cursor] + 1u < NATIVE_BLOCK_COMPILATION_THRESHOLD) continue;
		available[cursor] = 1;
		const auto op = static_cast<OpCode>(instruction.op);
		const u32 successor = cursor + instruction.width;
		const u32 successorPc = pc + static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		if (nativeBlockComparison(instruction.op)) {
			enqueue(successorPc, true);
			if (binding.readBytes && successor < DECODED_PAGE_WORDS) {
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) != 0u && successor < DECODED_PAGE_WORDS - 1u
					&& !decodeInstruction(frame, page, successor, successorPc, false)) return;
				if ((page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
					&& successor + page.words[successor].width <= DECODED_PAGE_WORDS)
					enqueue(successorPc + static_cast<u32>(page.words[successor].width) * INSTRUCTION_BYTES, true);
			}
		} else if (op == OpCode::JMP || op == OpCode::JMPIF || op == OpCode::JMPIFNOT) {
			enqueue(instruction.bx, true);
			if (op != OpCode::JMP) enqueue(successorPc, true);
		} else if (!nativeBlockEndsBlock(instruction.op, instruction.b)) enqueue(successorPc, false);
	}
	if (!available[word]) {
		page.words[word].dispatchOp = page.words[word].op;
		return;
	}
	std::array<NativeBlockInstruction, DECODED_PAGE_WORDS> instructions;
	std::vector<NativeBlockSource> sources;
	std::vector<u32> entries;
	size_t instructionCount = 0;
	for (u32 entry = 0; entry < DECODED_PAGE_WORDS; ++entry) {
		if (!leaders[entry] || !available[entry]) continue;
		const size_t first = instructionCount;
		u32 cursor = entry;
		for (;;) {
			const auto& instruction = page.words[cursor];
			instructions[instructionCount++] = {&instruction, pagePc + cursor * INSTRUCTION_BYTES};
			const u32 successor = cursor + instruction.width;
			if (nativeBlockEndsBlock(instruction.op, instruction.b) || successor >= DECODED_PAGE_WORDS
				|| !available[successor] || leaders[successor]) break;
			if (instructionCount - first == NATIVE_BLOCK_MAX_INSTRUCTIONS) { leaders[successor] = 1; break; }
			cursor = successor;
		}
		u8 skippedWidth = 0;
		if (binding.readBytes && nativeBlockComparison(page.words[cursor].op)) {
			const u32 successor = cursor + page.words[cursor].width;
			if (successor < DECODED_PAGE_WORDS && (page.refreshState[successor] & DECODED_REFRESH_DECODE) == 0u
				&& successor + page.words[successor].width <= DECODED_PAGE_WORDS) skippedWidth = page.words[successor].width;
		}
		sources.push_back({std::span(instructions.data() + first, instructionCount - first), skippedWidth});
		entries.push_back(entry);
	}
	for (const auto* region : merged) page.retireNativeRegion(region);
	if (!page.nativeBlocks) page.nativeBlocks = std::make_unique<NativeBlockPage>();
	NativeBlockExitHandlers handlers{};
	handlers[static_cast<size_t>(NativeBlockExit::ReadField)] = &CPU::compiledReadFieldExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteField)] = &CPU::compiledWriteFieldExit;
	handlers[static_cast<size_t>(NativeBlockExit::ReadMemory)] = &CPU::compiledReadMemoryExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteMemory)] = &CPU::compiledWriteMemoryExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteWords)] = &CPU::compiledWriteWordsExit;
	handlers[static_cast<size_t>(NativeBlockExit::ReadIndex)] = &CPU::compiledReadIndexExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteIndex)] = &CPU::compiledWriteIndexExit;
	handlers[static_cast<size_t>(NativeBlockExit::ReadInteger)] = &CPU::compiledReadIntegerExit;
	handlers[static_cast<size_t>(NativeBlockExit::WriteInteger)] = &CPU::compiledWriteIntegerExit;
	auto blocks = NativeBlock::compileRegion(sources, frame.executionImage->constPool.data(), m_nativeCodeBytes,
		m_memory, m_stringPool, handlers);
	for (size_t index = 0; index < entries.size(); ++index) {
		const u32 entry = entries[index];
		page.nativeBlocks->entries[entry] = std::move(blocks[index]);
		++page.nativeBlocks->count;
		page.words[entry].dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeBlock);
		page.words[entry].dispatchCycles = page.words[entry].baseCycles;
		page.refreshState[entry] &= static_cast<u8>(~DECODED_REFRESH_FUSION);
	}
	auto& lookup = frame.executionImage->nativeCodeLookup;
	if (!lookup) lookup = std::make_unique<NativeCodeLookup>();
	lookup->install(m_currentInstructionPc & ~MAPPED_PAGE_BYTE_MASK,
		m_memory.cartridgeController().selectedSlot(m_executionBusSignals), page);
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

NativeBlockTransition CPU::compiledReadIndexExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	const int a = exit->exitA;
	const Value base = frame->registers[exit->exitB];
	const Value key = owner->readRK(*frame->executionImage, frame->registers, exit->exitC);
	frame->registers[a] = valueIsString(key)
		? owner->loadTableFieldIndexCached(exit->tableCacheSlot, base, asStringId(key))
		: owner->loadTableIndex(base, key);
	frame->top = std::max(frame->top, a + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteIndexExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	const Value base = frame->registers[exit->exitA];
	const Value key = owner->readRK(*frame->executionImage, frame->registers, exit->exitB);
	const Value value = owner->readRK(*frame->executionImage, frame->registers, exit->exitC);
	if (valueIsString(key)) owner->storeTableFieldIndexCached(exit->tableCacheSlot, base, asStringId(key), value);
	else owner->storeTableIndex(base, key, value);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledReadIntegerExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	const int a = exit->exitA;
	frame->registers[a] = owner->loadTableIntegerIndex(frame->registers[exit->exitB], exit->exitC);
	frame->top = std::max(frame->top, a + 1);
	return NativeBlockTransition::NextInstruction;
}

NativeBlockTransition CPU::compiledWriteIntegerExit(CPU* owner, CallFrame* frame, const NativeBlockExitSite* exit) {
	owner->storeTableIntegerIndex(frame->registers[exit->exitA], exit->exitB,
		owner->readRK(*frame->executionImage, frame->registers, exit->exitC));
	return NativeBlockTransition::NextInstruction;
}

} // namespace bmsx
