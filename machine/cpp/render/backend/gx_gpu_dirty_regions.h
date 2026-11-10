#pragma once

#include "common/types.h"
#include "spec/gx/vram.h"
#include <algorithm>
#include <array>
#include <bit>

namespace bmsx {

// Physical VRAM ownership at 16x16-word granularity. A consumed cell is copied
// in full, so its untouched words must belong to the same backing surface.
// Drawing-cache allocations are 64-aligned; full VRAM surfaces are 16-aligned.
// Adjacent cells become horizontal runs and identical runs merge vertically.
class GxGpuDirtyRegions {
public:
	void clear() { m_rows = {}; }

	void mark(i32 left, i32 top, i32 right, i32 bottom) {
		if (right <= left || bottom <= top) return;
		const u32 first = static_cast<u32>(left) >> kCellShift;
		const u32 last = (static_cast<u32>(right) + kCellSize - 1u) >> kCellShift;
		const u32 low = columnMask(first, last, 0u), high = columnMask(first, last, 1u);
		const u32 endRow = (static_cast<u32>(bottom) + kCellSize - 1u) >> kCellShift;
		for (u32 row = static_cast<u32>(top) >> kCellShift; row < endRow; ++row) {
			m_rows[row][0] |= low;
			m_rows[row][1] |= high;
		}
	}

	template <typename Copy>
	bool consume(i32 left, i32 top, i32 right, i32 bottom, const Copy& copy) {
		if (right <= left || bottom <= top) return false;
		const u32 first = static_cast<u32>(left) >> kCellShift;
		const u32 last = (static_cast<u32>(right) + kCellSize - 1u) >> kCellShift;
		const u32 queryLow = columnMask(first, last, 0u), queryHigh = columnMask(first, last, 1u);
		const u32 endRow = (static_cast<u32>(bottom) + kCellSize - 1u) >> kCellShift;
		bool copied = false;
		for (u32 row = static_cast<u32>(top) >> kCellShift; row < endRow; ++row) {
			for (;;) {
				const u32 low = m_rows[row][0] & queryLow, high = m_rows[row][1] & queryHigh;
				if ((low | high) == 0u) break;
				const u32 start = low != 0u ? std::countr_zero(low) : 32u + std::countr_zero(high);
				u32 end = start + std::countr_one(m_rows[row][start >> 5u] >> (start & 31u));
				if (end == 32u && last > 32u) end += std::countr_one(m_rows[row][1]);
				end = std::min(end, last);
				const u32 runLow = columnMask(start, end, 0u), runHigh = columnMask(start, end, 1u);
				u32 next = row;
				do {
					m_rows[next][0] &= ~runLow;
					m_rows[next][1] &= ~runHigh;
					++next;
				} while (next < endRow && (m_rows[next][0] & runLow) == runLow
					&& (m_rows[next][1] & runHigh) == runHigh);
				copy(static_cast<i32>(start << kCellShift), static_cast<i32>(row << kCellShift),
					static_cast<i32>(end << kCellShift), static_cast<i32>(next << kCellShift));
				copied = true;
			}
		}
		return copied;
	}

private:
	static constexpr u32 kCellShift = 4u, kCellSize = 1u << kCellShift;
	static_assert(GX_GPU_VRAM_X_ADDRESS_PERIOD == 64u * kCellSize);
	static u32 columnMask(u32 first, u32 last, u32 half) {
		const i32 base = static_cast<i32>(half * 32u);
		const i32 begin = std::max(static_cast<i32>(first) - base, 0);
		const i32 end = std::min(static_cast<i32>(last) - base, 32);
		return end <= begin ? 0u : (0xffffffffu >> (32 - (end - begin))) << begin;
	}
	std::array<std::array<u32, 2>, GX_GPU_VRAM_Y_ADDRESS_PERIOD / kCellSize> m_rows{};
};

} // namespace bmsx
