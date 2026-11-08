#pragma once

#include <GLES2/gl2.h>
#include "render/backend/gles2/gx_gpu_raster_program.h"

namespace bmsx {
class OpenGLES2Backend;

// Locations belong to the linked variant, not to a renderer-wide shader role.
struct GxGpuTexturedProgram : GxGpuRasterProgram {
	bool opaqueWordOutput = false;
	GLint positionAttrib = -1;
	GLint colorAttrib = -1;
	GLint uvPlaneBaseAttrib = -1;
	GLint uvPlaneStepXAttrib = -1;
	GLint uvPlaneStepYAttrib = -1;
	GLint textureSourceAttrib = -1;
	GLint textureWindowAndUniform = -1;
	GLint textureWindowOrUniform = -1;
	GLint textureModeUniform = -1;
	GLint rawTextureUniform = -1;
	GLint blendEnableUniform = -1;
	GLint blendModeUniform = -1;
	GLint checkMaskBitUniform = -1;
	GLint setMaskBitUniform = -1;
	GLint ditherEnableUniform = -1;
	GLint skippedLineParityUniform = -1;
	GLint rasterPhaseUniform = -1;
	GLint logicalYBaseUniform = -1;
	GLint colorPlaneBaseAttrib = -1;
	GLint colorPlaneStepXAttrib = -1;
	GLint colorPlaneStepYAttrib = -1;

	void initialize(OpenGLES2Backend& backend, const char* label, const char* defines,
		bool framebufferFetch, bool textureBarrier);
};
} // namespace bmsx
