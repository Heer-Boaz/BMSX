#include "machine/common/hash.h"

namespace bmsx {

u32 fmix32(u32 h) {
	h ^= h >> 16u;
	h *= 0x85ebca6bU;
	h ^= h >> 13u;
	h *= 0xc2b2ae35U;
	h ^= h >> 16u;
	return h;
}

u32 xorshift32(u32 x) {
	x ^= x << 13u;
	x ^= x >> 17u;
	x ^= x << 5u;
	return x;
}

u32 scramble32(u32 x) {
	return x * 0x9e3779bbU;
}

i32 signed8FromHash(u32 h) {
	return static_cast<i32>((h >> 24u) & 0xFFu) - 128;
}

} // namespace bmsx
