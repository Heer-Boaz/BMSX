#include "render/backend/gles2/draw_state.h"
#include <iostream>
#include <stdexcept>

namespace {
unsigned calls = 0;
unsigned attributeCalls = 0;
unsigned bufferCalls = 0;
unsigned programCalls = 0;
unsigned framebufferCalls = 0;
void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}
}

// Driver-independent command-sink test: inspect the externally emitted state,
// not private cache fields. The EGL parity suites exercise real draw results.
extern "C" {
void GL_APIENTRY glUseProgram(GLuint) { ++calls; ++programCalls; }
void GL_APIENTRY glBindBuffer(GLenum, GLuint) { ++calls; ++bufferCalls; }
void GL_APIENTRY glBindFramebuffer(GLenum, GLuint) { ++calls; ++framebufferCalls; }
void GL_APIENTRY glViewport(GLint, GLint, GLsizei, GLsizei) { ++calls; }
void GL_APIENTRY glScissor(GLint, GLint, GLsizei, GLsizei) { ++calls; }
void GL_APIENTRY glEnable(GLenum) { ++calls; }
void GL_APIENTRY glDisable(GLenum) { ++calls; }
void GL_APIENTRY glDepthMask(GLboolean) { ++calls; }
void GL_APIENTRY glColorMask(GLboolean, GLboolean, GLboolean, GLboolean) { ++calls; }
void GL_APIENTRY glBlendFuncSeparate(GLenum, GLenum, GLenum, GLenum) { ++calls; }
void GL_APIENTRY glBlendColor(GLfloat, GLfloat, GLfloat, GLfloat) { ++calls; }
void GL_APIENTRY glBlendEquationSeparate(GLenum, GLenum) { ++calls; }
void GL_APIENTRY glEnableVertexAttribArray(GLuint) { ++calls; }
void GL_APIENTRY glDisableVertexAttribArray(GLuint) { ++calls; }
void GL_APIENTRY glVertexAttribPointer(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*) { ++calls; ++attributeCalls; }
}

int main() {
	using namespace bmsx;
	GLES2DrawState state;
	const auto apply = [&] {
		state.useProgram(17u);
		state.bindFramebuffer(4u);
		state.bindBuffer(GL_ARRAY_BUFFER, 9u);
		state.bindBuffer(GL_ELEMENT_ARRAY_BUFFER, 12u);
		state.viewport(-64, -256, 1024, 1024);
		state.scissor(8, 7, 16, 19);
		state.disable(GLES2Capability::DepthTest);
		state.enable(GLES2Capability::ScissorTest);
		state.depthMask(GL_FALSE);
		state.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_FALSE);
		state.blendFuncSeparate(GL_ONE, GL_ZERO, GL_ONE, GL_ZERO);
		state.blendEquationSeparate(GL_FUNC_ADD, GL_FUNC_ADD);
		state.blendColor(0.0f, 0.0f, 0.0f, 0.5f);
		state.enableVertexAttribArray(0u);
		state.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 16, nullptr);
	};
	apply();
	const unsigned first = calls;
	require(first == 15u, "initial state is fully emitted, including known-default values");
	apply();
	require(calls == first, "an unchanged draw does not reapply driver state");
	state.bindBuffer(GL_ARRAY_BUFFER, 10u);
	state.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 16, nullptr);
	require(attributeCalls == 2u, "attribute identity includes its captured vertex buffer");
	state.bindBuffer(GL_ELEMENT_ARRAY_BUFFER, 10u);
	state.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 16, nullptr);
	require(attributeCalls == 2u, "element-buffer changes do not invalidate vertex fetch");
	state.forgetBuffer(10u);
	const unsigned beforeReusedBuffer = bufferCalls;
	state.bindBuffer(GL_ARRAY_BUFFER, 10u);
	state.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 16, nullptr);
	require(bufferCalls == beforeReusedBuffer + 1u && attributeCalls == 3u,
		"a deleted and reused buffer name must be rebound and recaptured");
	state.forgetProgram(17u);
	state.useProgram(17u);
	require(programCalls == 2u, "a reused program name is applied again");
	state.viewport(0, 0, 320, 240);
	const unsigned beforeViewportRestore = calls;
	state.bindFramebuffer(4u);
	state.viewport(-64, -256, 1024, 1024);
	require(calls == beforeViewportRestore + 1u && framebufferCalls == 1u,
		"restoring a copy-modified viewport does not require rebinding the same framebuffer");
	state.disableVertexAttribArray(0u);
	state.disableVertexAttribArray(0u);
	state.invalidate();
	const unsigned beforeExternalBoundary = calls;
	apply();
	require(calls == beforeExternalBoundary + first, "frontend/context invalidation republishes every required state");
	std::cout << "GLES2 applied draw state passed\n";
}
