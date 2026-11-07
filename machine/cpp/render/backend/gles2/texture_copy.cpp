#include "texture_copy.h"
#include "backend.h"

namespace bmsx {
void GLES2TextureCopy::initialize(OpenGLES2Backend& backend, const GLES2Texture& target) {
	const char* vertex =
		"precision highp float; attribute vec2 a_position; uniform vec4 u_region;"
		"varying mediump vec2 v_uv; void main(){gl_Position=vec4(a_position,0.0,1.0);"
		"v_uv=u_region.xy+(a_position*0.5+0.5)*u_region.zw;}";
	const char* fragment =
		"precision mediump float;uniform sampler2D u_source;varying mediump vec2 v_uv;"
		"void main(){gl_FragColor=texture2D(u_source,v_uv);}";
	const GLES2AttributeBinding bindings[]{{0, "a_position"}};
	program = backend.buildProgram(vertex, fragment, "texture_copy", nullptr, bindings);
	regionUniform = glGetUniformLocation(program, "u_region");
	glUseProgram(program);
	glUniform1i(glGetUniformLocation(program, "u_source"), 0);
	glGenFramebuffers(1, &framebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target.id, 0);
	constexpr GLfloat triangle[]{-1, -1, 3, -1, -1, 3};
	glGenBuffers(1, &vertices);
	glBindBuffer(GL_ARRAY_BUFFER, vertices);
	glBufferData(GL_ARRAY_BUFFER, sizeof(triangle), triangle, GL_STATIC_DRAW);
}

void GLES2TextureCopy::copy(OpenGLES2Backend& backend, GLES2Texture& source,
	int left, int top, int right, int bottom) {
	backend.setRenderTarget(framebuffer, source.width, source.height);
	backend.setActiveTextureUnit(0);
	backend.bindTexture2D(&source);
	glViewport(left, top, right - left, bottom - top);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glDisable(GL_DITHER);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	glUseProgram(program);
	glUniform4f(regionUniform, static_cast<GLfloat>(left) / source.width,
		static_cast<GLfloat>(top) / source.height,
		static_cast<GLfloat>(right - left) / source.width,
		static_cast<GLfloat>(bottom - top) / source.height);
	glBindBuffer(GL_ARRAY_BUFFER, vertices);
	glEnableVertexAttribArray(0);
	glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}

void GLES2TextureCopy::dispose() {
	glDeleteProgram(program);
	glDeleteFramebuffers(1, &framebuffer);
	glDeleteBuffers(1, &vertices);
}
}
