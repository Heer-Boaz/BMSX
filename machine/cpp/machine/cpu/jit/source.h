#pragma once

#include <array>
#include <vector>

#include "machine/cpu/decoded_instruction.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"

namespace bmsx {

struct DecodedInstructionPage;

// A physical instruction page and its compilation graph. No running frame,
// register file, CPU PC latch or device access is needed to discover its source.
// The lazy compiler keeps this bounded workspace on its stack; the cold image
// preparation pass retains one per page until all incoming roots are discovered.
struct NativeCompilationSource {
	NativeCompilationSource(DecodedInstructionPage& page,
		MappedPageBinding binding, u32 pagePc, MappedBusSignals busSignals, u32 slot)
		: page(page), binding(binding), pagePc(pagePc), busSignals(busSignals), slot(slot) {}

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
