#pragma once

#include "render/backend/gles2/gx_gpu_raster_program.h"

namespace bmsx {
class OpenGLES2Backend;

struct GxGpuPrimitiveProgram : GxGpuRasterProgram {
	GLint positionAttrib = -1;
	GLint colorAttrib = -1;
	GLint colorPlaneBaseAttrib = -1;
	GLint colorPlaneStepXAttrib = -1;
	GLint colorPlaneStepYAttrib = -1;
	GLint startAttrib = -1;
	GLint endAttrib = -1;
	GLint color0Attrib = -1;
	GLint color1Attrib = -1;
	GLint blendEnableUniform = -1;
	GLint blendModeUniform = -1;
	GLint checkMaskBitUniform = -1;
	GLint setMaskBitUniform = -1;
	GLint ditherEnableUniform = -1;
	GLint skippedLineParityUniform = -1;
	GLint rasterPhaseUniform = -1;
	GLint logicalYBaseUniform = -1;

	std::array<GLint, 7> uniformState{};
	bool uniformStateValid = false;

	void initialize(OpenGLES2Backend& backend, const char* vertex, const char* fragment,
		const char* label, const char* defines);
};

} // namespace bmsx
