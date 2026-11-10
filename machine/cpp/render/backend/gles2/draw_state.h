#pragma once

#include <GLES2/gl2.h>
#include <array>
#include <cstdint>
#include <cstddef>

namespace bmsx {

// The context's applied draw state. Every GLES2 pass shares this owner; the
// frontend boundary invalidates it without querying the driver. Uniform state
// belongs to the program instead, and survives switching between programs.
enum class GLES2Capability : uint8_t {
	Blend, CullFace, DepthTest, Dither, PolygonOffsetFill, SampleAlphaToCoverage,
	SampleCoverage, ScissorTest, StencilTest,
};

class GLES2DrawState {
public:
	void invalidate();
	void useProgram(GLuint program);
	void bindBuffer(GLenum target, GLuint buffer);
	void bindFramebuffer(GLuint framebuffer);
	GLuint framebuffer() const { return m_framebuffer; }
	void forgetBuffer(GLuint buffer);
	void forgetProgram(GLuint program);
	void viewport(GLint x, GLint y, GLsizei width, GLsizei height);
	void scissor(GLint x, GLint y, GLsizei width, GLsizei height);
	void enable(GLES2Capability capability);
	void disable(GLES2Capability capability);
	void depthMask(GLboolean enabled);
	void colorMask(GLboolean red, GLboolean green, GLboolean blue, GLboolean alpha);
	void blendFuncSeparate(GLenum sourceRgb, GLenum destinationRgb, GLenum sourceAlpha, GLenum destinationAlpha);
	void blendEquationSeparate(GLenum rgb, GLenum alpha);
	void blendColor(GLfloat red, GLfloat green, GLfloat blue, GLfloat alpha);
	void enableVertexAttribArray(GLuint index);
	void disableVertexAttribArray(GLuint index);
	void vertexAttribPointer(GLuint index, GLint size, GLenum type, GLboolean normalized,
		GLsizei stride, const void* pointer);

private:
	enum Valid : uint32_t {
		Program = 1u, ArrayBuffer = 2u, ElementBuffer = 4u, Viewport = 8u,
		Scissor = 16u, DepthMask = 32u, ColorMask = 64u, BlendFunction = 128u,
		BlendEquation = 256u, Framebuffer = 512u, BlendColor = 1024u,
	};
	struct Attribute {
		GLuint buffer;
		GLint size;
		GLenum type;
		GLboolean normalized;
		GLsizei stride;
		const void* pointer;
		bool operator==(const Attribute&) const = default;
	};
	void capability(GLES2Capability name, bool enabled);
	uint32_t m_valid = 0u;
	uint32_t m_capabilitiesValid = 0u;
	uint32_t m_capabilitiesEnabled = 0u;
	uint32_t m_attributesValid = 0u;
	uint32_t m_attributeEnablesValid = 0u;
	uint32_t m_attributesEnabled = 0u;
	GLuint m_program = 0u;
	GLuint m_framebuffer = 0u;
	GLuint m_arrayBuffer = 0u;
	GLuint m_elementBuffer = 0u;
	std::array<GLint, 4> m_viewport{};
	std::array<GLint, 4> m_scissor{};
	GLboolean m_depthMask = GL_FALSE;
	std::array<GLboolean, 4> m_colorMask{};
	std::array<GLenum, 4> m_blendFunction{};
	std::array<GLenum, 2> m_blendEquation{};
	std::array<GLfloat, 4> m_blendColor{};
	// All GLES2 programs use the eight guaranteed attribute locations.
	std::array<Attribute, 8> m_attributes{};
};

} // namespace bmsx
