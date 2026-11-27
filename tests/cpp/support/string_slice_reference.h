#pragma once

#include "common/hash_fnv.h"
#include "machine/cpu/string_pool.h"

namespace bmsx::test {

// Frozen borrowed-slice entry from 20183c7fc. The production pool no longer
// exposes it; the differential oracle keeps the original borrow and roots.
struct StringSliceReference {
	static StringId intern(StringPool& pool, StringId id, size_t offset, size_t count) {
		const auto bytes = pool.readBytes(id, offset, count);
		const u32 hash = fnv1a32(bytes.wrapped, fnv1a32(bytes.first));
		if (const auto match = pool.lookup(hash, {bytes.first, {&bytes.wrapped, 1}, count})) return pool.retain(match);
		return pool.insert(bytes, hash, id);
	}
};

} // namespace bmsx::test
