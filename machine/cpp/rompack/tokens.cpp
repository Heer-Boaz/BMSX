#include "rompack/tokens.h"

#include <cstdio>

namespace bmsx {

AssetToken hashAssetId(std::string_view id) {
	u64 hash = 0xcbf29ce484222325ull;
	for (unsigned char c : id) {
		hash ^= static_cast<u64>(c);
		hash *= 0x100000001b3ull;
	}
	return AssetToken{
		static_cast<u32>(hash & 0xffffffffu),
		static_cast<u32>(hash >> 32),
	};
}

std::string tokenKey(u32 lo, u32 hi) {
	char buffer[17];
	std::snprintf(buffer, sizeof(buffer), "%08x%08x", hi, lo);
	return std::string(buffer);
}

std::string tokenKeyFromId(std::string_view id) {
	const AssetToken token = hashAssetId(id);
	return tokenKey(token.lo, token.hi);
}

} // namespace bmsx
