#include "render/backend/gles2/fullscreen_quad.h"

namespace bmsx {

void createGLES2ScreenQuad(GLES2ScreenQuad& quad) {
	glGenBuffers(1, &quad.positionBuffer);
	glGenBuffers(1, &quad.texcoordBuffer);
}

void destroyGLES2ScreenQuad(GLES2ScreenQuad& quad) {
	if (quad.positionBuffer != 0u) {
		glDeleteBuffers(1, &quad.positionBuffer);
	}
	if (quad.texcoordBuffer != 0u) {
		glDeleteBuffers(1, &quad.texcoordBuffer);
	}
	quad = GLES2ScreenQuad{};
}

void updateGLES2PostProcessQuad(GLES2ScreenQuad& quad, i32 width, i32 height) {
	if (quad.width == width && quad.height == height) {
		return;
	}
	quad.width = width;
	quad.height = height;

	const float w = static_cast<float>(width);
	const float h = static_cast<float>(height);
	const float positions[12] = {
		0.0f, 0.0f,
		0.0f, h,
		w, 0.0f,
		w, 0.0f,
		0.0f, h,
		w, h
	};
	const float texcoords[12] = {
		0.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 1.0f,
		1.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 0.0f
	};

	glBindBuffer(GL_ARRAY_BUFFER, quad.positionBuffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
	glBindBuffer(GL_ARRAY_BUFFER, quad.texcoordBuffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
}

void bindGLES2ScreenQuad(const GLES2ScreenQuad& quad, GLint positionAttrib, GLint texcoordAttrib) {
	glBindBuffer(GL_ARRAY_BUFFER, quad.positionBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(positionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(positionAttrib), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, quad.texcoordBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(texcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(texcoordAttrib), 2, GL_FLOAT, GL_FALSE, 0, nullptr);
}

} // namespace bmsx
