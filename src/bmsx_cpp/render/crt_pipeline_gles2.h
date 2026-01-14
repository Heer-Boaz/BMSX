/*
 * crt_pipeline_gles2.h - GLES2 CRT post-processing pipeline
 */

#ifndef BMSX_CRT_PIPELINE_GLES2_H
#define BMSX_CRT_PIPELINE_GLES2_H

#include "gameview.h"
#include "renderpasslib.h"
#include "gles2_backend.h"

namespace bmsx {
namespace CRTPipeline {

void initGLES2(OpenGLES2Backend* backend);
void initPresentGLES2(OpenGLES2Backend* backend);
void shutdownGLES2(OpenGLES2Backend* backend);
void renderPresentGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state);
void renderCRTGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state);

} // namespace CRTPipeline
} // namespace bmsx

#endif // BMSX_CRT_PIPELINE_GLES2_H
