/*
 * crt/pipeline.h - GLES2 CRT post-processing pipeline
 */

#ifndef BMSX_CRT_PIPELINE_H
#define BMSX_CRT_PIPELINE_H

#include "render/gameview.h"
#include "render/backend/pass/library.h"
#include "render/backend/gles2/backend.h"

namespace bmsx {
namespace CRTPipeline {

void initGLES2(OpenGLES2Backend* backend);
void initPresentGLES2(OpenGLES2Backend* backend);
void initDeviceQuantizeGLES2(OpenGLES2Backend* backend);
void shutdownGLES2(OpenGLES2Backend* backend);
void renderPresentGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state);
void renderCRTGLES2(OpenGLES2Backend* backend, GameView* context, const CRTPipelineState& state);
void renderDeviceQuantizeGLES2(OpenGLES2Backend* backend, GameView* context, const DeviceQuantizePipelineState& state);

} // namespace CRTPipeline
} // namespace bmsx

#endif // BMSX_CRT_PIPELINE_H
