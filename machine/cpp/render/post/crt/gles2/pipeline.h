/*
 * crt/gles2/pipeline.h - GLES2 CRT post-processing pipeline
 */

#ifndef BMSX_CRT_GLES2_PIPELINE_H
#define BMSX_CRT_GLES2_PIPELINE_H

#include "render/backend/gles2/fullscreen_quad.h"

#include <GLES2/gl2.h>

namespace bmsx {

class OpenGLES2Backend;
class RenderPassLibrary;

namespace CRTPipeline {

struct CRTGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_src_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_fragscale = -1;
	GLint uniform_time = -1;
	GLint uniform_random = -1;
	GLint uniform_apply_noise = -1;
	GLint uniform_apply_color_bleed = -1;
	GLint uniform_apply_scanlines = -1;
	GLint uniform_apply_blur = -1;
	GLint uniform_apply_glow = -1;
	GLint uniform_apply_fringing = -1;
	GLint uniform_apply_aperture = -1;
	GLint uniform_noise_intensity = -1;
	GLint uniform_color_bleed = -1;
	GLint uniform_blur_intensity = -1;
	GLint uniform_glow_color = -1;
	GLint uniform_texture = -1;
	FullscreenQuad quad;
};

struct PresentGLES2State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_texture = -1;
	FullscreenQuad quad;
};

void initPresentGLES2(OpenGLES2Backend& backend, PresentGLES2State& pipeline);
void shutdownPresentGLES2(PresentGLES2State& pipeline);
void initCRTGLES2(OpenGLES2Backend& backend, CRTGLES2State& pipeline);
void shutdownCRTGLES2(CRTGLES2State& pipeline);
void registerPresentationHistoryGLES2Passes(RenderPassLibrary& registry, PresentGLES2State& pipeline);
void registerPresentGLES2Pass(RenderPassLibrary& registry, PresentGLES2State& pipeline);
void registerCRTGLES2Pass(RenderPassLibrary& registry, CRTGLES2State& pipeline);

} // namespace CRTPipeline
} // namespace bmsx

#endif // BMSX_CRT_GLES2_PIPELINE_H
