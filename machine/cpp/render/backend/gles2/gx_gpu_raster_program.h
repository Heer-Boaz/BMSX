#pragma once

#include "render/backend/gles2/gx_gpu_target_uniforms.h"

namespace bmsx {

struct GxGpuRasterProgram {
	GLuint id = 0;
	GxGpuTargetUniforms target;
	bool hardwareBlending = false;
	bool twoPassTexturing = false;
	GLint blendClassUniform = -1;
};

} // namespace bmsx
