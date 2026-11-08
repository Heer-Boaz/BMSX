#include "render/backend/gles2/gx_gpu_primitive_program.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/texture_units.h"

namespace bmsx {

void GxGpuPrimitiveProgram::initialize(OpenGLES2Backend& backend, const char* vertex,
	const char* fragment, const char* label, const char* defines) {
	id = backend.buildProgram(vertex, fragment, label, defines);
	target.initialize(id);
	positionAttrib = glGetAttribLocation(id, "a_position");
	colorAttrib = glGetAttribLocation(id, "a_color");
	colorPlaneBaseAttrib = glGetAttribLocation(id, "a_colorPlaneBase");
	colorPlaneStepXAttrib = glGetAttribLocation(id, "a_colorPlaneStepX");
	colorPlaneStepYAttrib = glGetAttribLocation(id, "a_colorPlaneStepY");
	startAttrib = glGetAttribLocation(id, "a_lineStart");
	endAttrib = glGetAttribLocation(id, "a_lineEnd");
	color0Attrib = glGetAttribLocation(id, "a_color0");
	color1Attrib = glGetAttribLocation(id, "a_color1");
	blendEnableUniform = glGetUniformLocation(id, "u_blendEnable");
	blendModeUniform = glGetUniformLocation(id, "u_blendMode");
	checkMaskBitUniform = glGetUniformLocation(id, "u_checkMaskBit");
	setMaskBitUniform = glGetUniformLocation(id, "u_setMaskBit");
	ditherEnableUniform = glGetUniformLocation(id, "u_ditherEnable");
	skippedLineParityUniform = glGetUniformLocation(id, "u_skippedLineParity");
	rasterPhaseUniform = glGetUniformLocation(id, "u_rasterPhase");
	logicalYBaseUniform = glGetUniformLocation(id, "u_logicalYBase");
	glUseProgram(id);
	glUniform1i(glGetUniformLocation(id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
}

} // namespace bmsx
