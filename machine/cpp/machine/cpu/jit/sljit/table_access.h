#pragma once

#include "machine/cpu/jit/sljit/abi.h"

namespace bmsx {

// Shared scratch layout for string-table callers and the in-frame leaf.
// These are host temporaries, not table records or callsite feedback.
struct NativeTableScratch {
private:
	struct Layout {
		u32 receiver;
		union { u32 keyWord, arrayLength; };
		u32 wordOffset, tagOffset;
		sljit_sw path, returnAddress;
	};
	static constexpr auto begin = (NativeBlockAbi::helperResultOffset + alignof(Layout) - 1)
		& ~(alignof(Layout) - 1);
	static_assert(begin + sizeof(Layout) <= NativeBlockAbi::stackBytes);
public:
	static constexpr auto receiver = begin + offsetof(Layout, receiver);
	static constexpr auto keyWord = begin + offsetof(Layout, keyWord);
	static constexpr auto arrayLength = begin + offsetof(Layout, arrayLength);
	static constexpr auto wordOffset = begin + offsetof(Layout, wordOffset);
	static constexpr auto tagOffset = begin + offsetof(Layout, tagOffset);
	static constexpr auto path = begin + offsetof(Layout, path);
	static constexpr auto returnAddress = begin + offsetof(Layout, returnAddress);
};

// Inputs: R0 points to the aligned table header; R1 is a logical slot
// (including links in the word lane). Returns the physical RAM offset.
void emitTableSlotOffset(sljit_compiler*, sljit_s32 destination, bool word);
// With the header in R0, advance the key offsets in R1 (word) and R3
// (tag) to the corresponding value, clobbering R2.
void emitHashValueOffsets(sljit_compiler*);

// In-frame leaf: R0 = aligned receiver header, R1 = live path prediction,
// SP[keyWord] = StringId. Clobbers R0..R3, returns payload/tag in R2/R3.
// Nil signals decline; no guest slots, budget, or feedback are modified.
sljit_label* emitOneHopStringRead(sljit_compiler*);

} // namespace bmsx
