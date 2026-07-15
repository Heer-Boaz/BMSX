#include "render/backend/gles2/gx_character_plane.h"

#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/shaders/gx_character_plane_shaders.h"
#include "render/backend/pass/library.h"

namespace bmsx {
namespace {

constexpr i32 CHARACTER_CELL_TEXTURE_UNIT = 0;
constexpr i32 CHARACTER_GLYPH_TEXTURE_UNIT = 1;
constexpr i32 CHARACTER_PALETTE_TEXTURE_UNIT = 2;

void renderGxCharacterPlaneGLES2(
	OpenGLES2Backend& backend,
	GxCharacterPlaneGLES2Pipeline& pipeline,
	const GxCharacterPlanePipelineState& state) {
	const GxCharacterPlaneOutput& output = *state.output;
	if (pipeline.cellRevision != output.cellRevision) {
		writeGxCharacterPlaneCellTexture(output.cellBytes, pipeline.cellPixels);
		backend.updateTexture(
			pipeline.cellTexture,
			pipeline.cellPixels.data(),
			static_cast<i32>(GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH),
			static_cast<i32>(GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT),
			RGBA8_LINEAR_TEXTURE_PARAMS);
		pipeline.cellRevision = output.cellRevision;
	}
	if (pipeline.glyphRevision != output.glyphRevision) {
		writeGxCharacterPlaneGlyphTexture(output.glyphBytes, pipeline.glyphPixels);
		backend.updateTexture(
			pipeline.glyphTexture,
			pipeline.glyphPixels.data(),
			static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH),
			static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT),
			RGBA8_LINEAR_TEXTURE_PARAMS);
		pipeline.glyphRevision = output.glyphRevision;
	}
	if (pipeline.paletteRevision != output.paletteRevision) {
		writeGxCharacterPlanePaletteTexture(output.paletteBytes, pipeline.palettePixels);
		backend.updateTexture(
			pipeline.paletteTexture,
			pipeline.palettePixels.data(),
			static_cast<i32>(GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH),
			static_cast<i32>(GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT),
			RGBA8_LINEAR_TEXTURE_PARAMS);
		pipeline.paletteRevision = output.paletteRevision;
	}

	glUseProgram(pipeline.program);
	glUniform2f(pipeline.resolutionUniform, static_cast<f32>(state.width), static_cast<f32>(state.height));
	updateFullscreenQuad(pipeline.quad, state.width, state.height);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	backend.setActiveTextureUnit(CHARACTER_CELL_TEXTURE_UNIT);
	backend.bindTexture2D(pipeline.cellTexture);
	backend.setActiveTextureUnit(CHARACTER_GLYPH_TEXTURE_UNIT);
	backend.bindTexture2D(pipeline.glyphTexture);
	backend.setActiveTextureUnit(CHARACTER_PALETTE_TEXTURE_UNIT);
	backend.bindTexture2D(pipeline.paletteTexture);
	bindFullscreenQuad(pipeline.quad, pipeline.positionAttribute, pipeline.texcoordAttribute);
	glDrawArrays(GL_TRIANGLES, 0, 6);
}

} // namespace

void initGxCharacterPlaneGLES2(OpenGLES2Backend& backend, GxCharacterPlaneGLES2Pipeline& pipeline) {
	pipeline.program = backend.buildProgram(kGxCharacterPlaneVertexShader, kGxCharacterPlaneFragmentShader, "gx_character_plane");
	pipeline.positionAttribute = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.texcoordAttribute = glGetAttribLocation(pipeline.program, "a_texcoord");
	pipeline.resolutionUniform = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.scaleUniform = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.cellTextureUniform = glGetUniformLocation(pipeline.program, "u_character_cells");
	pipeline.glyphTextureUniform = glGetUniformLocation(pipeline.program, "u_character_glyphs");
	pipeline.paletteTextureUniform = glGetUniformLocation(pipeline.program, "u_character_palette");
	pipeline.cellTexture = backend.createTexture(
		pipeline.cellPixels.data(),
		static_cast<i32>(GX_CHARACTER_PLANE_CELL_TEXTURE_WIDTH),
		static_cast<i32>(GX_CHARACTER_PLANE_CELL_TEXTURE_HEIGHT),
		RGBA8_LINEAR_TEXTURE_PARAMS);
	pipeline.glyphTexture = backend.createTexture(
		pipeline.glyphPixels.data(),
		static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_TEXTURE_WIDTH),
		static_cast<i32>(GX_CHARACTER_PLANE_GLYPH_TEXTURE_HEIGHT),
		RGBA8_LINEAR_TEXTURE_PARAMS);
	pipeline.paletteTexture = backend.createTexture(
		pipeline.palettePixels.data(),
		static_cast<i32>(GX_CHARACTER_PLANE_PALETTE_TEXTURE_WIDTH),
		static_cast<i32>(GX_CHARACTER_PLANE_PALETTE_TEXTURE_HEIGHT),
		RGBA8_LINEAR_TEXTURE_PARAMS);
	createFullscreenQuad(pipeline.quad);
	glUseProgram(pipeline.program);
	glUniform1f(pipeline.scaleUniform, 1.0f);
	glUniform1i(pipeline.cellTextureUniform, CHARACTER_CELL_TEXTURE_UNIT);
	glUniform1i(pipeline.glyphTextureUniform, CHARACTER_GLYPH_TEXTURE_UNIT);
	glUniform1i(pipeline.paletteTextureUniform, CHARACTER_PALETTE_TEXTURE_UNIT);
}

void shutdownGxCharacterPlaneGLES2(OpenGLES2Backend& backend, GxCharacterPlaneGLES2Pipeline& pipeline) {
	backend.destroyTexture(pipeline.cellTexture);
	backend.destroyTexture(pipeline.glyphTexture);
	backend.destroyTexture(pipeline.paletteTexture);
	destroyFullscreenQuad(pipeline.quad);
	glDeleteProgram(pipeline.program);
	pipeline = GxCharacterPlaneGLES2Pipeline{};
}

void registerGxCharacterPlanePassGLES2(RenderPassLibrary& registry, GxCharacterPlaneGLES2Pipeline& pipeline) {
	RenderPassDef desc;
	desc.id = "gx_character_plane";
	desc.name = "GXCharacterPlane";
	setGxCharacterPlaneGraph(desc);
	desc.context = &pipeline;
	desc.exec = executePipelineRenderPass<
		OpenGLES2Backend,
		GxCharacterPlaneGLES2Pipeline,
		GxCharacterPlanePipelineState,
		&RenderPassStateStorage::gxCharacterPlane,
		renderGxCharacterPlaneGLES2>;
	desc.shouldExecute = shouldExecuteGxCharacterPlanePass;
	registry.registerPass(desc);
}

} // namespace bmsx
