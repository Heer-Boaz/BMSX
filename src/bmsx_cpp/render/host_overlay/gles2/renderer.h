#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/host_overlay/commands.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2_backend.h"
#endif

namespace bmsx {

#if BMSX_ENABLE_GLES2
void bootstrapHostOverlayGLES2(OpenGLES2Backend& backend);
void beginHostOverlayGLES2(OpenGLES2Backend& backend, const Host2DPipelineState& state);
void renderHost2DEntryGLES2(OpenGLES2Backend& backend, Host2DKind kind, Host2DRef ref);
void endHostOverlayGLES2(OpenGLES2Backend& backend);
#endif

} // namespace bmsx
