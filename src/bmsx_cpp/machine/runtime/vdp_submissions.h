#pragma once

#include "render/shared/submissions.h"

namespace bmsx {
class Runtime;

namespace VdpSubmissions {

void submitSprite(Runtime& runtime, const ImgRenderSubmission& options);
void submitRectangle(Runtime& runtime, const RectRenderSubmission& options);
void submitDrawPolygon(Runtime& runtime, const PolyRenderSubmission& options);
void submitGlyphs(Runtime& runtime, const GlyphRenderSubmission& options);

} // namespace VdpSubmissions
} // namespace bmsx
