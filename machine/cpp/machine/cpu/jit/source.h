#pragma once

#include <algorithm>
#include <array>
#include <bitset>
#include <span>
#include <vector>

#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/limits.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"

namespace bmsx {

struct DecodedInstructionPage;

// One immutable image owns one physical page namespace.
struct NativeWarmupPages {
	bool include(u32 pagePc) {
		const auto admitted = std::span(pages).first(count);
		if (std::ranges::find(admitted, pagePc) != admitted.end()) return true;
		if (count == pages.size()) return false;
		pages[count++] = pagePc;
		return true;
	}

	std::array<u32, NATIVE_IMAGE_WARMUP_MAX_PAGES> pages{};
	size_t count = 0;
};

struct NativeWarmupAdmission {
	// Bound decoded work independently of the pages an installed region uses.
	NativeWarmupPages requested;
	NativeWarmupPages published;
};

// A physical instruction page and its compilation graph. No running frame,
// register file, CPU PC latch or device access is needed to discover its source.
// The lazy compiler keeps this bounded workspace on its stack; the cold image
// preparation pass retains one per page until all incoming roots are discovered.
struct NativeCompilationSource {
	NativeCompilationSource(DecodedInstructionPage& page,
		MappedPageBinding binding, u32 pagePc, MappedBusSignals busSignals, u32 slot, bool verifiedRom = false)
		: page(page), binding(binding), pagePc(pagePc), busSignals(busSignals), slot(slot), verifiedRom(verifiedRom) {}

	void enqueue(u32 pc, bool leader, std::vector<u32>* outgoing = nullptr, bool root = false) {
		if (pc < firstPc || pc > lastPc) return;
		const u32 offset = pc - pagePc;
		if (offset >= MAPPED_PAGE_BYTE_SIZE) {
			if (outgoing) outgoing->push_back(pc);
			return;
		}
		const u32 word = offset / INSTRUCTION_BYTES;
		if (root) roots[word] = 1;
		if (leader || queued[word]) leaders.set(word);
		if (!queued[word]) { queued[word] = 1; pending[pendingCount++] = word; }
	}

	DecodedInstructionPage& page;
	MappedPageBinding binding;
	u32 pagePc;
	MappedBusSignals busSignals;
	u32 slot;
	bool verifiedRom;
	u32 firstPc = 0u, lastPc = ~0u;
	std::array<u8, DECODED_PAGE_WORDS> roots{}, queued{}, available{};
	std::bitset<DECODED_PAGE_WORDS> leaders;
	std::array<u32, DECODED_PAGE_WORDS> pending{};
	size_t pendingCount = 0, discoveredCount = 0;
	bool discoveryQueued = false;
};

} // namespace bmsx
