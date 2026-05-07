#include "rompack/tokens.h"

#include <cstdio>

namespace bmsx {

AssetToken hashAssetToken(std::string_view id) {
	AssetToken hash = 0xcbf29ce484222325ull;
	for (unsigned char c : id) {
		hash ^= static_cast<AssetToken>(c);
		hash *= 0x100000001b3ull;
	}
	return hash;
}

AssetTokenParts hashAssetId(std::string_view id) {
	return splitAssetToken(hashAssetToken(id));
}

AssetToken makeAssetToken(u32 lo, u32 hi) {
	return (static_cast<AssetToken>(hi) << 32) | static_cast<AssetToken>(lo);
}

AssetTokenParts splitAssetToken(AssetToken token) {
	return AssetTokenParts{
		static_cast<u32>(token & 0xffffffffu),
		static_cast<u32>(token >> 32),
	};
}

std::string tokenKey(u32 lo, u32 hi) {
	char buffer[17];
	std::snprintf(buffer, sizeof(buffer), "%08x%08x", hi, lo);
	return std::string(buffer);
}

std::string tokenKeyFromId(std::string_view id) {
	const AssetTokenParts token = hashAssetId(id);
	return tokenKey(token.lo, token.hi);
}

} // namespace bmsx
