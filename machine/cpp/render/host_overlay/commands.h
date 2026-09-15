#pragma once

#include "common/primitives.h"

namespace bmsx {

struct GlyphRenderSubmission;
struct HostImageRenderSubmission;
struct HostFrameRenderSubmission;
struct PolyRenderSubmission;
struct RectRenderSubmission;
struct HostOverlayClipRect;
struct HostOverlayTransform;

enum class Host2DKind : u8 {
	Img,
	Poly,
	Rect,
	Glyphs,
	Clip,
	Transform,
	Frame,
};

union Host2DRef {
	const HostImageRenderSubmission* img;
	const HostFrameRenderSubmission* frame;
	const PolyRenderSubmission* poly;
	const RectRenderSubmission* rect;
	const GlyphRenderSubmission* glyphs;
	const HostOverlayClipRect* clip;
	const HostOverlayTransform* transform;
};
static_assert(sizeof(Host2DRef) == sizeof(const void*));

} // namespace bmsx
