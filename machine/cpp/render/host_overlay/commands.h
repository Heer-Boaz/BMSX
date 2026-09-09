#pragma once

#include "common/primitives.h"

namespace bmsx {

struct GlyphRenderSubmission;
struct HostImageRenderSubmission;
struct PolyRenderSubmission;
struct RectRenderSubmission;
struct HostOverlayClipRect;

enum class Host2DKind : u8 {
	Img,
	Poly,
	Rect,
	Glyphs,
	Clip,
};

union Host2DRef {
	const HostImageRenderSubmission* img;
	const PolyRenderSubmission* poly;
	const RectRenderSubmission* rect;
	const GlyphRenderSubmission* glyphs;
	const HostOverlayClipRect* clip;
};
static_assert(sizeof(Host2DRef) == sizeof(const void*));

} // namespace bmsx
