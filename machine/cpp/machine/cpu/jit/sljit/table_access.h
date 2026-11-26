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
		u32 keyTag;
		sljit_sw returnAddress;
		sljit_sw header;
		u32 remaining;
	};
	static constexpr auto begin = (NativeBlockAbi::helperResultOffset + alignof(Layout) - 1)
		& ~(alignof(Layout) - 1);
	static_assert(begin + sizeof(Layout) <= NativeBlockAbi::stackBytes);
public:
	static constexpr auto header = begin + offsetof(Layout, header);
	static constexpr auto remaining = begin + offsetof(Layout, remaining);
	static constexpr auto receiver = begin + offsetof(Layout, receiver);
	static constexpr auto keyWord = begin + offsetof(Layout, keyWord);
	static constexpr auto arrayLength = begin + offsetof(Layout, arrayLength);
	static constexpr auto wordOffset = begin + offsetof(Layout, wordOffset);
	static constexpr auto tagOffset = begin + offsetof(Layout, tagOffset);
	static constexpr auto fieldKey = receiver;
	static constexpr auto visitCost = wordOffset;
	static constexpr auto linkCycles = tagOffset;
	static constexpr auto keyTag = begin + offsetof(Layout, keyTag);
	static constexpr auto returnAddress = begin + offsetof(Layout, returnAddress);
};

// Inputs: R0 points to the aligned table header; R1 is a logical array slot. Returns the physical RAM offset.
void emitArraySlotOffset(sljit_compiler*, sljit_s32 destination, bool word);
// R0 = header, R1 = slot, R3 = hash count. Bind backing once for both
// independently mirrored key lanes. Returns word in R1 and tag in R3.
void emitHashKeyOffsets(sljit_compiler*);
// With the header in R0, advance the key offsets in R1 (word) and R3
// (tag) to the corresponding value, clobbering R2.
void emitHashValueOffsets(sljit_compiler*);

// R0 = aligned receiver header, SP[keyWord] = StringId. Returns R0 = visit
// charge (-1 for semantic exit), R1 = own slot or -1, R2/R3 = value lanes.
sljit_label* emitStringReadProbe(sljit_compiler*);

// Repair an own-slot hint without entering an inherited path. Preserves the
// receiver header in R0; returns the nonnil slot or -1 in R1, value in R2/R3.
sljit_label* emitOwnStringSlotProbe(sljit_compiler*);

// R0 = receiver header, R2 = Integer or Table tag, R3 = key payload.
// Preserves R0 and returns the raw value in R2/R3, or nil on absence.
sljit_label* emitIndexReadProbe(sljit_compiler*);

// R0 = table address. Returns its verified array boundary or -1 for semantic lookup.
sljit_label* emitTableLengthProbe(sljit_compiler*);

struct NativeTableIteratorScratch {
private:
	struct Layout {
		u32 cursor, arrayEnd, hashStorage, hashCount, valueTag;
		sljit_sw words, returnAddress;
	};
	static constexpr auto begin = (NativeBlockAbi::helperResultOffset + alignof(Layout) - 1)
		& ~(alignof(Layout) - 1);
	static_assert(begin + sizeof(Layout) <= NativeBlockAbi::stackBytes);
public:
	static constexpr auto cursor = begin + offsetof(Layout, cursor);
	static constexpr auto arrayEnd = begin + offsetof(Layout, arrayEnd);
	static constexpr auto hashStorage = begin + offsetof(Layout, hashStorage);
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
