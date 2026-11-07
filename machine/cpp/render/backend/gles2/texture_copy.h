#pragma once
#include <GLES2/gl2.h>

namespace bmsx {
class OpenGLES2Backend;
struct GLES2Texture;

// A copy is its own render pass. Callers bind their draw state after the pass;
// no driver-state queries or hidden restoration are needed.
class GLES2TextureCopy {
public:
	void initialize(OpenGLES2Backend& backend, const GLES2Texture& target);
	void copy(OpenGLES2Backend& backend, GLES2Texture& source,
		int left, int top, int right, int bottom);
	void dispose();
private:
	GLuint program = 0;
	GLuint framebuffer = 0;
	GLuint vertices = 0;
	GLint regionUniform = -1;
};
}
