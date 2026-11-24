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
		union { sljit_sw path; u32 keyTag; };
		sljit_sw returnAddress;
		sljit_sw words, tags;
	};
	static constexpr auto begin = (NativeBlockAbi::helperResultOffset + alignof(Layout) - 1)
		& ~(alignof(Layout) - 1);
	static_assert(begin + sizeof(Layout) <= NativeBlockAbi::stackBytes);
public:
	static constexpr auto words = begin + offsetof(Layout, words);
	static constexpr auto tags = begin + offsetof(Layout, tags);
	static constexpr auto receiver = begin + offsetof(Layout, receiver);
	static constexpr auto keyWord = begin + offsetof(Layout, keyWord);
	static constexpr auto arrayLength = begin + offsetof(Layout, arrayLength);
	static constexpr auto wordOffset = begin + offsetof(Layout, wordOffset);
	static constexpr auto tagOffset = begin + offsetof(Layout, tagOffset);
	static constexpr auto path = begin + offsetof(Layout, path);
	static constexpr auto keyTag = begin + offsetof(Layout, keyTag);
	static constexpr auto returnAddress = begin + offsetof(Layout, returnAddress);
};

// Inputs: R0 points to the aligned table header; R1 is a logical slot
// (including links in the word lane). Returns the physical RAM offset.
void emitTableSlotOffset(sljit_compiler*, sljit_s32 destination, bool word);
// With the header in R0, advance the key offsets in R1 (word) and R3
// (tag) to the corresponding value, clobbering R2.
void emitHashValueOffsets(sljit_compiler*);

// In-frame leaf: R0 = receiver header, R1 = inherited path or null for
// an own probe, SP[keyWord] = StringId. Clobbers R0..R3. On success,
// R2/R3 hold the value and R1 is the own hash slot or -1 for inheritance.
// A nil tag declines. The caller owns the visit charge and slot feedback.
sljit_label* emitStringReadProbe(sljit_compiler*);

// R0 = receiver header, R2 = Integer or Table tag, R3 = key payload.
// Preserves R0 and returns the raw value in R2/R3, or nil on absence.
sljit_label* emitIndexReadProbe(sljit_compiler*);

struct NativeTableIteratorScratch {
private:
	struct Layout {
		u32 cursor, arrayEnd, hashEnd, hashCount, valueTag;
		sljit_sw words, returnAddress;
	};
	static constexpr auto begin = (NativeBlockAbi::helperResultOffset + alignof(Layout) - 1)
		& ~(alignof(Layout) - 1);
	static_assert(begin + sizeof(Layout) <= NativeBlockAbi::stackBytes);
public:
	static constexpr auto cursor = begin + offsetof(Layout, cursor);
	static constexpr auto arrayEnd = begin + offsetof(Layout, arrayEnd);
	static constexpr auto hashEnd = begin + offsetof(Layout, hashEnd);
	static constexpr auto hashCount = begin + offsetof(Layout, hashCount);
	static constexpr auto valueTag = begin + offsetof(Layout, valueTag);
	static constexpr auto words = begin + offsetof(Layout, words);
	static constexpr auto returnAddress = begin + offsetof(Layout, returnAddress);
};

// In-frame ITERN leaf. R0 = raw table address, R1 = physical cursor.
// Returns key/value tags in R0/R1, payloads in R2/R3, and the new cursor
// in scratch. Exhaustion returns zero payloads, Nil tags and cursor zero.
sljit_label* emitTableIteratorScan(sljit_compiler*);

} // namespace bmsx
