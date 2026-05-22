/*
 * framebuffer_pipeline.h - host-managed framebuffer texture presentation pass
 */

#ifndef BMSX_RENDER_2D_FRAMEBUFFER_PIPELINE_H
#define BMSX_RENDER_2D_FRAMEBUFFER_PIPELINE_H

#include "render/backend/backend.h"

namespace bmsx {

class RenderPassLibrary;

void registerFramebuffer2DPass_Software(RenderPassLibrary& registry);

#if BMSX_ENABLE_GLES2
void registerFramebuffer2DPass_GLES2(RenderPassLibrary& registry);
void shutdownFramebuffer2DGLES2();
#endif

} // namespace bmsx

#endif // BMSX_RENDER_2D_FRAMEBUFFER_PIPELINE_H
