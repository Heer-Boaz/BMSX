#pragma once

#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {

// One horizontal run of render pixels on row y, starting at x. Vertex colors
// are (fixed >> fraction bits) & 0xff, with fixed advancing by its step per
// pixel when interpolated. Flat spans pass their RGB bytes shifted by the
// fraction bits and ignore the steps.
struct GxGpuSoftwareColorSpan {
	u32 rFixed;
	u32 gFixed;
	u32 bFixed;
	u32 rStep;
	u32 gStep;
	u32 bStep;
	u32 blendMode;
	bool checkMaskBit;
	bool setMaskBit;
};

namespace gx_gpu_span_detail {

inline u32 colorByte(u32 fixed) {
	return (fixed >> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xffu;
}

template<bool InterpolatesColor>
inline void advanceColors(GxGpuSoftwareColorSpan& span, u32 pixels) {
	if constexpr (InterpolatesColor) {
		span.rFixed += span.rStep * pixels;
		span.gFixed += span.gStep * pixels;
		span.bFixed += span.bStep * pixels;
	}
}

} // namespace gx_gpu_span_detail
} // namespace bmsx
