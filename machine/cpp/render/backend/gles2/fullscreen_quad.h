#pragma once

#include "common/types.h"

#include <GLES2/gl2.h>

namespace bmsx {

struct FullscreenQuad {
	GLuint positionBuffer = 0u;
	GLuint texcoordBuffer = 0u;
	i32 width = -1;
	i32 height = -1;
};

void createFullscreenQuad(FullscreenQuad& quad);
void destroyFullscreenQuad(FullscreenQuad& quad);
void updateFullscreenQuad(FullscreenQuad& quad, i32 width, i32 height);
void bindFullscreenQuad(const FullscreenQuad& quad, GLint positionAttrib, GLint texcoordAttrib);

} // namespace bmsx
