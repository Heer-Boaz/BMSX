#pragma once

#include "common/primitives.h"
#include <GLES2/gl2.h>
#include <array>

namespace bmsx {

// The viewport relocates unchanged guest vertices into a cached VRAM region.
// Fragment datapaths retain logical coordinates and sample a local destination.
struct GxGpuTargetUniforms {
	GLint origin = -1;
	GLint size = -1;
	std::array<i32, 4> retained{-1, -1, -1, -1};

	void initialize(GLuint program) {
		origin = glGetUniformLocation(program, "u_targetOrigin");
		size = glGetUniformLocation(program, "u_targetSize");
	}
	void write(i32 x, i32 y, i32 width, i32 height) {
		const std::array<i32, 4> value{x, y, width, height};
		if (value == retained) return;
		glUniform2i(origin, x, y);
		glUniform2f(size, static_cast<f32>(width), static_cast<f32>(height));
		retained = value;
	}
};

} // namespace bmsx
