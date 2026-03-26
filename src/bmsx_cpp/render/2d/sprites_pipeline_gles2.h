/*
 * sprites_pipeline_gles2.h - GLES2 sprite pipeline
 */

#ifndef BMSX_SPRITES_PIPELINE_GLES2_H
#define BMSX_SPRITES_PIPELINE_GLES2_H

#include "../gameview.h"
#include "../backend/renderpasslib.h"
#include "../backend/gles2_backend.h"

namespace bmsx {
namespace SpritesPipeline {

void initGLES2(OpenGLES2Backend* backend, GameView* context);
void shutdownGLES2(OpenGLES2Backend* backend);
void renderSpriteBatchGLES2(OpenGLES2Backend* backend, GameView* context, const SpritesPipelineState& state, const std::vector<Sorted2DDrawEntry>& sortedEntries, bool useDepth);

} // namespace SpritesPipeline
} // namespace bmsx

#endif // BMSX_SPRITES_PIPELINE_GLES2_H
