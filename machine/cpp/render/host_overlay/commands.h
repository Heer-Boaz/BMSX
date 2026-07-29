#pragma once

#include "common/primitives.h"

namespace bmsx {

struct GlyphRenderSubmission;
struct HostImageRenderSubmission;
struct PolyRenderSubmission;
struct RectRenderSubmission;

enum class Host2DKind : u8 {
	Img,
	Poly,
	Rect,
	Glyphs,
};

union Host2DRef {
	const HostImageRenderSubmission* img;
	const PolyRenderSubmission* poly;
	const RectRenderSubmission* rect;
	const GlyphRenderSubmission* glyphs;
};
static_assert(sizeof(Host2DRef) == sizeof(const void*));

} // namespace bmsx
