#pragma once

#include <algorithm>
#include <array>
#include <bit>

#include "machine/cpu/decoded_instruction.h"

namespace bmsx {

// Guest instruction heads within one physical page, in increasing PC order.
class NativePageWords {
public:
	void set(u32 index) { m_words[index / 32] |= u32{1} << (index % 32); }
	NativePageWords& operator|=(const NativePageWords& other) {
		for (size_t group = 0; group < m_words.size(); ++group) m_words[group] |= other.m_words[group];
		return *this;
	}
	void reset(u32 index) { m_words[index / 32] &= ~(u32{1} << (index % 32)); }
	// First member of [first, end), or end. Restartable after retirement
	// removes multiple entries from the same physical page.
	u32 next(u32 first, u32 end) const {
		if (first >= end) return end;
		u32 group = first / 32;
		u32 bits = m_words[group] & (~u32{0} << (first % 32));
		while (!bits) {
			if (++group * 32u >= end) return end;
			bits = m_words[group];
		}
		return std::min(end, group * 32u + static_cast<u32>(std::countr_zero(bits)));
	}
	// Snapshot only the current group. The visitor may discover new
	// members in later groups before traversal reaches them.
	static constexpr u32 GROUP_BITS = 32;
	template<class Visit> void forEachCommon(const NativePageWords& other, Visit&& visit) const {
		for (u32 i = 0; i < m_words.size(); ++i)
			for (u32 bits = m_words[i] & other.m_words[i]; bits; bits &= bits - 1u)
				visit(i * GROUP_BITS + std::countr_zero(bits));
	}
	bool operator[](u32 index) const { return (m_words[index / 32] >> (index % 32)) & 1u; }
	template<class Visit> void forEach(Visit&& visit) const {
		for (u32 i = 0; i < m_words.size(); ++i)
			for (u32 bits = m_words[i]; bits; bits &= bits - 1u)
				visit(i * 32u + std::countr_zero(bits));
	}

private:
	std::array<u32, (DECODED_PAGE_WORDS + 31) / 32> m_words{};
};

} // namespace bmsx
