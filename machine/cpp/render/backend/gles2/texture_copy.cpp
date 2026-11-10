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
	backend.drawState.useProgram(program);
	glUniform1i(glGetUniformLocation(program, "u_source"), 0);
	glGenFramebuffers(1, &framebuffer);
	backend.drawState.bindFramebuffer(framebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target.id, 0);
	constexpr GLfloat triangle[]{-1, -1, 3, -1, -1, 3};
	glGenBuffers(1, &vertices);
	backend.drawState.bindBuffer(GL_ARRAY_BUFFER, vertices);
	glBufferData(GL_ARRAY_BUFFER, sizeof(triangle), triangle, GL_STATIC_DRAW);
}

void GLES2TextureCopy::copy(OpenGLES2Backend& backend, GLES2Texture& source,
	int left, int top, int right, int bottom) {
	backend.drawState.bindFramebuffer(framebuffer);
	backend.setActiveTextureUnit(0);
	backend.bindTexture2D(&source);
	backend.drawState.viewport(left, top, right - left, bottom - top);
	backend.drawState.disable(GLES2Capability::ScissorTest);
	backend.drawState.disable(GLES2Capability::DepthTest);
	backend.drawState.disable(GLES2Capability::CullFace);
	backend.drawState.disable(GLES2Capability::Blend);
	backend.drawState.disable(GLES2Capability::Dither);
	backend.drawState.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	backend.drawState.useProgram(program);
	glUniform4f(regionUniform, static_cast<GLfloat>(left) / source.width,
		static_cast<GLfloat>(top) / source.height,
		static_cast<GLfloat>(right - left) / source.width,
		static_cast<GLfloat>(bottom - top) / source.height);
	backend.drawState.bindBuffer(GL_ARRAY_BUFFER, vertices);
	backend.drawState.enableVertexAttribArray(0);
	backend.drawState.vertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}

void GLES2TextureCopy::dispose() {
	glDeleteProgram(program);
	glDeleteFramebuffers(1, &framebuffer);
	glDeleteBuffers(1, &vertices);
}
}
