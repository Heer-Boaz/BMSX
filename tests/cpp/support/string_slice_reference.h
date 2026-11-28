#pragma once

#include "common/hash_fnv.h"
#include "string_pool_reference.h"

namespace bmsx::test {

// Frozen borrowed-slice entry from 20183c7fc. The production pool no longer
// exposes it; the differential oracle keeps the original borrow and roots.
struct StringSliceReference {
	static StringId intern(StringPoolReference& pool, StringId id, size_t offset, size_t count) {
		const auto bytes = pool.readBytes(id, offset, count);
		const u32 hash = fnv1a32(bytes.wrapped, fnv1a32(bytes.first));
		if (const auto match = pool.lookup(hash, {bytes.first, {&bytes.wrapped, 1}, count})) return pool.retain(match);
		return pool.insert(bytes, hash, id);
	}

	// Frozen concatenation oracle; include wrapped source segments before allocation.
	static StringId concat(StringPoolReference& pool, StringId left, u32 leftBytes, StringId right, u32 rightBytes) {
		const auto a = pool.readBytes(left, 0, leftBytes), b = pool.readBytes(right, 0, rightBytes);
		const std::string_view tail[]{a.wrapped, b.first, b.wrapped};
		const StringPoolReference::InternKey key{a.first, tail, a.size() + b.size()};
		u32 hash = fnv1a32(key.head);
		for (const auto part : tail) hash = fnv1a32(part, hash);
		if (const auto match = pool.lookup(hash, key)) return pool.retain(match);
		// Snapshot the source before allocation can collect or reuse an operand.
		std::string text;
		text.reserve(key.length);
		text.append(key.head);
		for (const auto part : tail) text.append(part);
		return pool.insert({text, {}}, hash, 0u);
	}
};

} // namespace bmsx::test
