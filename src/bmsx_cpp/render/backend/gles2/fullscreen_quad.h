#pragma once

#include "common/types.h"

#include <GLES2/gl2.h>

namespace bmsx {

struct GLES2ScreenQuad {
	GLuint positionBuffer = 0u;
	GLuint texcoordBuffer = 0u;
	i32 width = -1;
	i32 height = -1;
};

void createGLES2ScreenQuad(GLES2ScreenQuad& quad);
void destroyGLES2ScreenQuad(GLES2ScreenQuad& quad);
void updateGLES2PostProcessQuad(GLES2ScreenQuad& quad, i32 width, i32 height);
void bindGLES2ScreenQuad(const GLES2ScreenQuad& quad, GLint positionAttrib, GLint texcoordAttrib);

} // namespace bmsx
