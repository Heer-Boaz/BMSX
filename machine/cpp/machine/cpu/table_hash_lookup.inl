#pragma once

#include "machine/cpu/table.h"

namespace bmsx {

template<bool BulkWrite>
int TableRecord::HashStorage<BulkWrite>::findNode(const Value& key, u32 home, bool matchDead) const {
	const auto tag = valueTag(key);
	const u32 payload = valuePayload(key);
	const bool collectableKey = matchDead && (tag == ValueTag::Table || tag == ValueTag::Closure || tag == ValueTag::Thread);
	int index = static_cast<int>(home);
	for (u32 remaining = count; index >= 0 && remaining != 0u; --remaining) {
		const u32 slot = static_cast<u32>(index);
		const u32 keySlot = slot;
		const auto nodeTag = slots.tag(keySlot);
		if (nodeTag == tag) {
			if (slots.word(keySlot) == payload) return index;
		} else if (collectableKey && nodeTag == ValueTag::Nil && slots.word(keySlot) == valueTagHeader(tag)) {
			const u32 valueSlot = keySlot + count;
			if (slots.tag(valueSlot) == ValueTag::DeadKey && slots.word(valueSlot) == payload) return index;
		}
		index = next(slot);
	}
	return -1;
}

template<bool BulkWrite>
inline int TableRecord::HashStorage<BulkWrite>::scanStringNodes(StringId key, i32& node, u32& available) const {
	while (node >= 0 && available != 0u) {
		const i32 slot = node;
		--available;
		if (matchesString(slot, key)) {
			node = -1;
			return slot;
		}
		node = next(slot);
	}
	return -1;
}

template<bool BulkWrite>
inline int TableRecord::HashStorage<BulkWrite>::findString(StringId key, u32 home, u32* linkCycles) const {
	i32 node = static_cast<i32>(home);
	u32 remaining = count;
	const int slot = scanStringNodes(key, node, remaining);
	if (linkCycles) {
		const u32 inspected = count - remaining;
		const u32 included = slot >= 0 ? TABLE_STRING_HIT_BASE_NODES : 1u;
		if (inspected > included) *linkCycles += inspected - included;
	}
	return slot;
}

} // namespace bmsx
