#pragma once

#include "render/backend/backend.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/gx/character_plane_resources.h"

#include <GLES2/gl2.h>

namespace bmsx {

class OpenGLES2Backend;
class RenderPassLibrary;

struct GxCharacterPlaneGLES2Pipeline {
	GLuint program = 0u;
	GLint positionAttribute = -1;
	GLint texcoordAttribute = -1;
	GLint resolutionUniform = -1;
	GLint scaleUniform = -1;
	GLint cellTextureUniform = -1;
	GLint glyphTextureUniform = -1;
	GLint paletteTextureUniform = -1;
	FullscreenQuad quad;
	TextureHandle cellTexture = nullptr;
	TextureHandle glyphTexture = nullptr;
	TextureHandle paletteTexture = nullptr;
	std::array<u8, GX_CHARACTER_PLANE_CELL_TEXTURE_BYTES> cellPixels{};
	std::array<u8, GX_CHARACTER_PLANE_GLYPH_TEXTURE_BYTES> glyphPixels{};
	std::array<u8, GX_CHARACTER_PLANE_PALETTE_TEXTURE_BYTES> palettePixels{};
	u32 cellRevision = 0u;
	u32 glyphRevision = 0u;
	u32 paletteRevision = 0u;
};

void initGxCharacterPlaneGLES2(OpenGLES2Backend& backend, GxCharacterPlaneGLES2Pipeline& pipeline);
void shutdownGxCharacterPlaneGLES2(OpenGLES2Backend& backend, GxCharacterPlaneGLES2Pipeline& pipeline);
void registerGxCharacterPlanePassGLES2(RenderPassLibrary& registry, GxCharacterPlaneGLES2Pipeline& pipeline);

} // namespace bmsx
