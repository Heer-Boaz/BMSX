#include "render/backend/gles2/fullscreen_quad.h"

namespace bmsx {
namespace {

constexpr float POST_PROCESS_TEXCOORDS[12] = {
	0.0f, 1.0f,
	0.0f, 0.0f,
	1.0f, 1.0f,
	1.0f, 1.0f,
	0.0f, 0.0f,
	1.0f, 0.0f
};

} // namespace

void createFullscreenQuad(FullscreenQuad& quad) {
	glGenBuffers(1, &quad.positionBuffer);
	glGenBuffers(1, &quad.texcoordBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, quad.texcoordBuffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(POST_PROCESS_TEXCOORDS), POST_PROCESS_TEXCOORDS, GL_STATIC_DRAW);
}

void destroyFullscreenQuad(FullscreenQuad& quad) {
	if (quad.positionBuffer != 0u) {
		glDeleteBuffers(1, &quad.positionBuffer);
	}
	if (quad.texcoordBuffer != 0u) {
		glDeleteBuffers(1, &quad.texcoordBuffer);
	}
	quad = FullscreenQuad{};
}

void updateFullscreenQuad(FullscreenQuad& quad, i32 width, i32 height) {
	if (quad.width == width && quad.height == height) {
		return;
	}
	quad.width = width;
	quad.height = height;
	const float w = static_cast<float>(width);
	const float h = static_cast<float>(height);
	quad.positions[0] = 0.0f;
	quad.positions[1] = 0.0f;
	quad.positions[2] = 0.0f;
	quad.positions[3] = h;
	quad.positions[4] = w;
	quad.positions[5] = 0.0f;
	quad.positions[6] = w;
	quad.positions[7] = 0.0f;
	quad.positions[8] = 0.0f;
	quad.positions[9] = h;
	quad.positions[10] = w;
	quad.positions[11] = h;

	glBindBuffer(GL_ARRAY_BUFFER, quad.positionBuffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(quad.positions), quad.positions.data(), GL_STATIC_DRAW);
}

void bindFullscreenQuad(const FullscreenQuad& quad, GLint positionAttrib, GLint texcoordAttrib) {
	glBindBuffer(GL_ARRAY_BUFFER, quad.positionBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(positionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(positionAttrib), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, quad.texcoordBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(texcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(texcoordAttrib), 2, GL_FLOAT, GL_FALSE, 0, nullptr);
}

} // namespace bmsx
