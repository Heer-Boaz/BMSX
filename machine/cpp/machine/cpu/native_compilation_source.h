#pragma once

#include "machine/cpu/execution_image.h"
#include "machine/memory/mapped_page.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

// A physical instruction page and its compilation graph. No running frame,
// register file, CPU PC latch or device access is needed to discover its source.
// The lazy compiler keeps this bounded workspace on its stack; the cold image
// preparation pass retains one per page until all incoming roots are discovered.
struct NativeCompilationSource {
	NativeCompilationSource(Blua32ExecutionImage& image, DecodedInstructionPage& page,
		MappedPageBinding binding, u32 pagePc, MappedBusSignals busSignals, u32 slot)
		: image(image), page(page), binding(binding), pagePc(pagePc), busSignals(busSignals), slot(slot) {}

	// Emission specializes constant operands. A source word that cannot bind
	// those constants is not compilable; executing it remains the CPU's job.
	bool canEmit(const DecodedInstruction& instruction) const {
		if (!nativeBlockSupports(instruction.op)) return false;
		const u8 rk = OPCODE_RK_OPERANDS[instruction.op];
		if (((rk & RK_OPERAND_B) != 0u && instruction.b < 0
				&& static_cast<size_t>(-instruction.b - 1) >= image.constPool.size())
			|| ((rk & RK_OPERAND_C) != 0u && instruction.c < 0
				&& static_cast<size_t>(-instruction.c - 1) >= image.constPool.size())) return false;
		switch (static_cast<OpCode>(instruction.op)) {
			case OpCode::LOADK: return instruction.bx < image.constPool.size();
			case OpCode::GETFIELD: case OpCode::SELF:
				return static_cast<size_t>(instruction.c) < image.constPool.size();
			case OpCode::SETFIELD:
				return static_cast<size_t>(instruction.b) < image.constPool.size();
			default: return true;
		}
	}

	void enqueue(u32 pc, bool leader, std::vector<u32>* outgoing = nullptr, bool root = false) {
		const u32 offset = pc - pagePc;
		if (offset >= MAPPED_PAGE_BYTE_SIZE) {
			if (outgoing) outgoing->push_back(pc);
			return;
		}
		const u32 word = offset / INSTRUCTION_BYTES;
		if (root) roots[word] = 1;
		if (leader || queued[word]) leaders[word] = 1;
		if (!queued[word]) { queued[word] = 1; pending[pendingCount++] = word; }
	}

	Blua32ExecutionImage& image;
	DecodedInstructionPage& page;
	MappedPageBinding binding;
	u32 pagePc;
	MappedBusSignals busSignals;
	u32 slot;
	std::array<u8, DECODED_PAGE_WORDS> roots{}, queued{}, available{}, leaders{};
	std::array<u32, DECODED_PAGE_WORDS> pending{};
	size_t pendingCount = 0, discoveredCount = 0;
	bool discoveryQueued = false;
};

} // namespace bmsx
