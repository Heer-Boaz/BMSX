#include "render/backend/gles2/gx_gpu_textured_program.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"

namespace bmsx {
void GxGpuTexturedProgram::initialize(OpenGLES2Backend& backend, const char* label,
	const char* defines, bool framebufferFetch, bool textureBarrier) {
	id = backend.buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, label, defines);
	target.initialize(id);
	blendClassUniform = glGetUniformLocation(id, "u_blendClass");
	positionAttrib = glGetAttribLocation(id, "a_position");
	colorAttrib = glGetAttribLocation(id, "a_color");
	uvPlaneBaseAttrib = glGetAttribLocation(id, "a_uvPlaneBase");
	uvPlaneStepXAttrib = glGetAttribLocation(id, "a_uvPlaneStepX");
	uvPlaneStepYAttrib = glGetAttribLocation(id, "a_uvPlaneStepY");
	textureSourceAttrib = glGetAttribLocation(id, "a_textureSource");
	textureWindowAndUniform = glGetUniformLocation(id, "u_textureWindowAnd");
	textureWindowOrUniform = glGetUniformLocation(id, "u_textureWindowOr");
	textureModeUniform = glGetUniformLocation(id, "u_textureMode");
	rawTextureUniform = glGetUniformLocation(id, "u_rawTexture");
	blendEnableUniform = glGetUniformLocation(id, "u_blendEnable");
	blendModeUniform = glGetUniformLocation(id, "u_blendMode");
	checkMaskBitUniform = glGetUniformLocation(id, "u_checkMaskBit");
	setMaskBitUniform = glGetUniformLocation(id, "u_setMaskBit");
	ditherEnableUniform = glGetUniformLocation(id, "u_ditherEnable");
	skippedLineParityUniform = glGetUniformLocation(id, "u_skippedLineParity");
	rasterPhaseUniform = glGetUniformLocation(id, "u_rasterPhase");
	logicalYBaseUniform = glGetUniformLocation(id, "u_logicalYBase");
	colorPlaneBaseAttrib = glGetAttribLocation(id, "a_colorPlaneBase");
	colorPlaneStepXAttrib = glGetAttribLocation(id, "a_colorPlaneStepX");
	colorPlaneStepYAttrib = glGetAttribLocation(id, "a_colorPlaneStepY");
	glUseProgram(id);
	glUniform1i(glGetUniformLocation(id, "u_vram"), GLES2_TEXTURE_UNIT_GX_SAMPLE);
	if (!framebufferFetch) {
		glUniform1i(glGetUniformLocation(id, "u_destination"),
			textureBarrier || backend.gxGpuDrawTargetMode() != GxGpuDrawTargetMode::FullVram
				? GLES2_TEXTURE_UNIT_GX_DESTINATION : GLES2_TEXTURE_UNIT_GX_SAMPLE);
	}
}
} // namespace bmsx
