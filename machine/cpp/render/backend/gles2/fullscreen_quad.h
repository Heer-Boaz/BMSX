#pragma once

#include "common/types.h"
#include "render/backend/gles2/draw_state.h"

#include <GLES2/gl2.h>
#include <array>

namespace bmsx {

struct FullscreenQuad {
	GLuint positionBuffer = 0u;
	GLuint texcoordBuffer = 0u;
	i32 width = -1;
	i32 height = -1;
	std::array<float, 12> positions{};
};

void createFullscreenQuad(GLES2DrawState& state, FullscreenQuad& quad);
void destroyFullscreenQuad(GLES2DrawState& state, FullscreenQuad& quad);
void updateFullscreenQuad(GLES2DrawState& state, FullscreenQuad& quad, i32 width, i32 height);
void bindFullscreenQuad(GLES2DrawState& state, const FullscreenQuad& quad, GLint positionAttrib, GLint texcoordAttrib);

} // namespace bmsx
