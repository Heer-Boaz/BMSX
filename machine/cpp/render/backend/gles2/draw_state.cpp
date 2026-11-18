#include "render/backend/gles2/draw_state.h"

namespace bmsx {

void GLES2DrawState::invalidate() {
	m_valid = 0u;
	m_capabilitiesValid = 0u;
	m_attributesValid = 0u;
	m_attributeEnablesValid = 0u;
}

void GLES2DrawState::useProgram(GLuint program) {
	if ((m_valid & Program) != 0u && m_program == program) return;
	glUseProgram(program);
	m_program = program;
	m_valid |= Program;
}

void GLES2DrawState::bindBuffer(GLenum target, GLuint buffer) {
	const uint32_t valid = target == GL_ARRAY_BUFFER ? ArrayBuffer : ElementBuffer;
	GLuint& current = target == GL_ARRAY_BUFFER ? m_arrayBuffer : m_elementBuffer;
	if ((m_valid & valid) != 0u && current == buffer) return;
	glBindBuffer(target, buffer);
	current = buffer;
	m_valid |= valid;
}

void GLES2DrawState::bindFramebuffer(GLuint framebuffer) {
	if ((m_valid & Framebuffer) != 0u && m_framebuffer == framebuffer) return;
	glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
	m_framebuffer = framebuffer;
	m_valid |= Framebuffer;
}

void GLES2DrawState::forgetBuffer(GLuint buffer) {
	if (m_arrayBuffer == buffer) m_valid &= ~ArrayBuffer;
	if (m_elementBuffer == buffer) m_valid &= ~ElementBuffer;
	for (size_t index = 0; index < m_attributes.size(); ++index)
		if (m_attributes[index].buffer == buffer) m_attributesValid &= ~(1u << index);
}

void GLES2DrawState::forgetProgram(GLuint program) {
	if (m_program == program) m_valid &= ~Program;
}

void GLES2DrawState::viewport(GLint x, GLint y, GLsizei width, GLsizei height) {
	const std::array<GLint, 4> value{x, y, width, height};
	if ((m_valid & Viewport) != 0u && m_viewport == value) return;
	glViewport(x, y, width, height);
	m_viewport = value;
	m_valid |= Viewport;
}

void GLES2DrawState::scissor(GLint x, GLint y, GLsizei width, GLsizei height) {
	const std::array<GLint, 4> value{x, y, width, height};
	if ((m_valid & Scissor) != 0u && m_scissor == value) return;
	glScissor(x, y, width, height);
	m_scissor = value;
	m_valid |= Scissor;
}

void GLES2DrawState::capability(GLES2Capability name, bool enabled) {
	constexpr GLenum names[]{GL_BLEND, GL_CULL_FACE, GL_DEPTH_TEST, GL_DITHER,
		GL_POLYGON_OFFSET_FILL, GL_SAMPLE_ALPHA_TO_COVERAGE, GL_SAMPLE_COVERAGE,
		GL_SCISSOR_TEST, GL_STENCIL_TEST};
	const uint32_t index = static_cast<uint32_t>(name);
	const uint32_t bit = 1u << index;
	if ((m_capabilitiesValid & bit) != 0u && ((m_capabilitiesEnabled & bit) != 0u) == enabled) return;
	if (enabled) glEnable(names[index]); else glDisable(names[index]);
	m_capabilitiesValid |= bit;
	if (enabled) m_capabilitiesEnabled |= bit; else m_capabilitiesEnabled &= ~bit;
}

void GLES2DrawState::enable(GLES2Capability name) { capability(name, true); }
void GLES2DrawState::disable(GLES2Capability name) { capability(name, false); }

void GLES2DrawState::depthMask(GLboolean enabled) {
	if ((m_valid & DepthMask) != 0u && m_depthMask == enabled) return;
	glDepthMask(enabled);
	m_depthMask = enabled;
	m_valid |= DepthMask;
}

void GLES2DrawState::colorMask(GLboolean red, GLboolean green, GLboolean blue, GLboolean alpha) {
	const std::array<GLboolean, 4> value{red, green, blue, alpha};
	if ((m_valid & ColorMask) != 0u && m_colorMask == value) return;
	glColorMask(red, green, blue, alpha);
	m_colorMask = value;
	m_valid |= ColorMask;
}

void GLES2DrawState::blendFuncSeparate(GLenum sourceRgb, GLenum destinationRgb, GLenum sourceAlpha, GLenum destinationAlpha) {
	const std::array<GLenum, 4> value{sourceRgb, destinationRgb, sourceAlpha, destinationAlpha};
	if ((m_valid & BlendFunction) != 0u && m_blendFunction == value) return;
	glBlendFuncSeparate(sourceRgb, destinationRgb, sourceAlpha, destinationAlpha);
	m_blendFunction = value;
	m_valid |= BlendFunction;
}

void GLES2DrawState::blendEquationSeparate(GLenum rgb, GLenum alpha) {
	const std::array<GLenum, 2> value{rgb, alpha};
	if ((m_valid & BlendEquation) != 0u && m_blendEquation == value) return;
	glBlendEquationSeparate(rgb, alpha);
	m_blendEquation = value;
	m_valid |= BlendEquation;
}

void GLES2DrawState::blendColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha) {
	const std::array<GLfloat, 4> value{red, green, blue, alpha};
	if ((m_valid & BlendColor) != 0u && m_blendColor == value) return;
	glBlendColor(red, green, blue, alpha);
	m_blendColor = value;
	m_valid |= BlendColor;
}

void GLES2DrawState::enableVertexAttribArray(GLuint index) {
	const uint32_t bit = 1u << index;
	if ((m_attributeEnablesValid & bit) != 0u && (m_attributesEnabled & bit) != 0u) return;
	glEnableVertexAttribArray(index);
	m_attributeEnablesValid |= bit;
	m_attributesEnabled |= bit;
}

void GLES2DrawState::disableVertexAttribArray(GLuint index) {
	const uint32_t bit = 1u << index;
	if ((m_attributeEnablesValid & bit) != 0u && (m_attributesEnabled & bit) == 0u) return;
	glDisableVertexAttribArray(index);
	m_attributeEnablesValid |= bit;
	m_attributesEnabled &= ~bit;
}

void GLES2DrawState::vertexAttribPointer(GLuint index, GLint size, GLenum type, GLboolean normalized,
	GLsizei stride, const void* pointer) {
	const Attribute value{m_arrayBuffer, size, type, normalized, stride, pointer};
	const uint32_t bit = 1u << index;
	if ((m_attributesValid & bit) != 0u && m_attributes[index] == value) return;
	glVertexAttribPointer(index, size, type, normalized, stride, pointer);
	m_attributes[index] = value;
	m_attributesValid |= bit;
}

} // namespace bmsx
