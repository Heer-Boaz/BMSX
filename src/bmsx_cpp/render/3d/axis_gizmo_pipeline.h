#pragma once

#include "common/primitives.h"
#include "render/shared/submissions.h"

#include <string_view>

namespace bmsx {

#if BMSX_ENABLE_GLES2
class OpenGLES2Backend;

// Mirrors the TS host-image sink callback. C++ carries an explicit context
// pointer instead of std::function/closures to keep the overlay hot path free
// from heap allocation and type-erased dispatch.
using AxisGizmoHostImageSink = void (*)(void* context, std::string_view imgid, f32 x, f32 y, f32 z, f32 scale, color colorValue);

void setAxisGizmoEnabled(bool v);
bool shouldRenderAxisGizmo();
void bootstrapAxisGizmo_GLES2(OpenGLES2Backend& backend);
void renderAxisGizmo_GLES2(OpenGLES2Backend& backend, AxisGizmoHostImageSink emitHostImage, void* emitHostImageContext);
#endif

} // namespace bmsx
