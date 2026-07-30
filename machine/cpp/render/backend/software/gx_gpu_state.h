#pragma once

#include "common/primitives.h"
#include "render/backend/gx_gpu_render_rules.h"

#include <array>
#include <cstddef>
#include <vector>

namespace bmsx {

struct GxGpuSoftwareTriangleEdgeSpan {
	i32 rowValue = 0;
	i32 rowStep = 0;
	i32 boundary = 0;
	i32 boundaryStep = 0;
	i32 remainder = 0;
	i32 remainderStep = 0;
	i32 denominator = 0;
	i32 boundaryKind = 0;

	void initialize(i64 initialRowValue, i64 stepX, i64 stepY) {
		rowValue = static_cast<i32>(initialRowValue);
		rowStep = static_cast<i32>(stepY);
		boundary = 0;
		boundaryStep = 0;
		remainder = 0;
		remainderStep = 0;
		denominator = 0;
		boundaryKind = 0;
		i32 numerator;
		i32 numeratorStep;
		if (stepX > 0) {
			denominator = static_cast<i32>(stepX);
			numerator = -rowValue + denominator - 1;
			numeratorStep = -rowStep;
			boundaryKind = 1;
		} else if (stepX < 0) {
			denominator = static_cast<i32>(-stepX);
			numerator = rowValue;
			numeratorStep = rowStep;
			boundaryKind = -1;
		} else {
			return;
		}
		boundary = numerator / denominator;
		remainder = numerator - boundary * denominator;
		if (remainder < 0) {
			boundary -= 1;
			remainder += denominator;
		}
		boundaryStep = numeratorStep / denominator;
		remainderStep = numeratorStep - boundaryStep * denominator;
		if (remainderStep < 0) {
			boundaryStep -= 1;
			remainderStep += denominator;
		}
	}

	bool intersect(i32& firstOffset, i32& lastOffset) const {
		if (boundaryKind > 0) {
			if (boundary > firstOffset) {
				firstOffset = boundary;
			}
			return firstOffset <= lastOffset;
		}
		if (boundaryKind < 0) {
			if (boundary < lastOffset) {
				lastOffset = boundary;
			}
			return firstOffset <= lastOffset;
		}
		return rowValue >= 0;
	}

	void advance() {
		if (boundaryKind == 0) {
			rowValue += rowStep;
			return;
		}
		boundary += boundaryStep;
		remainder += remainderStep;
		if (remainder >= denominator) {
			remainder -= denominator;
			boundary += 1;
		}
	}
};

struct GxGpuSoftwareState {
	explicit GxGpuSoftwareState(size_t vramByteCount, size_t interlacedPixelCount)
		: vram(vramByteCount >> 1u)
		, vramWordMask(vram.size() - 1u)
		, vramSnapshotScratch(vramByteCount)
		, interlacedPixels(interlacedPixelCount) {
	}

	std::vector<u16> vram;
	size_t vramWordMask;
	std::vector<u8> vramSnapshotScratch;
	size_t processedCommandCount = 0u;
	u32 processedCommandSerial = 0u;
	u64 vramSnapshotSerial = 0u;
	std::vector<u32> interlacedPixels;
	i32 interlacedWidth = 0;
	i32 interlacedHeight = 0;
	bool interlacedValid = false;
	u64 interlacedVramReplacementSerial = 0u;
	std::array<u32, GX_GPU_TRIANGLE_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> triangleUvPlaneScratch{};
	std::array<u32, GX_GPU_TRIANGLE_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> triangleColorPlaneScratch{};
	GxGpuSoftwareTriangleEdgeSpan triangleEdge0;
	GxGpuSoftwareTriangleEdgeSpan triangleEdge1;
	GxGpuSoftwareTriangleEdgeSpan triangleEdge2;
	std::array<i32, 2u> triangleSpanBounds{};
};

} // namespace bmsx
