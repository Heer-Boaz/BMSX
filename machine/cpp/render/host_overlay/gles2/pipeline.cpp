#include "render/host_overlay/gles2/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/texture_units.h"
#include "render/host_overlay/gles2/host_overlay_shaders.h"
#include "render/shared/glyph_runs.h"
#include "render/shared/submissions.h"
#include "render/host_overlay/atlas.h"
#include <cmath>
#include <string_view>

namespace bmsx {
namespace {

void bindTexture(OpenGLES2Backend& backend, TextureHandle texture) {
	backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_HOST_2D);
	backend.bindTexture2D(texture);
}

HostAtlasGLES2Texture& atlasTexture(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const HostAtlas& atlas) {
	auto entry = pipeline.atlases.find(&atlas);
	if (entry == pipeline.atlases.end()) {
		// The GLES2 host pass composites display-space bytes directly, without an sRGB target.
		auto texture = backend.createTexture(atlas.pixels.data(), static_cast<i32>(atlas.width), static_cast<i32>(atlas.height), RGBA8_LINEAR_TEXTURE_PARAMS);
		entry = pipeline.atlases.emplace(&atlas, HostAtlasGLES2Texture{texture}).first;
	}
	return entry->second;
}

void appendQuadGLES2(HostOverlayGLES2State& pipeline, f32 x, f32 y, f32 w, f32 h, f32 u0, f32 v0, f32 u1, f32 v1, u32 color) {
	const float left = x;
	const float top = y;
	const float right = x + w;
	const float bottom = y + h;
	const float vertices[24] = {
		left, top, u0, v0,
		left, bottom, u0, v1,
		right, top, u1, v0,
		right, top, u1, v0,
		left, bottom, u0, v1,
		right, bottom, u1, v1,
	};
	pipeline.drawList.appendQuad(vertices, color);
}

void appendRectGLES2(HostOverlayGLES2State& pipeline, const RectRenderSubmission& command) {
	const auto& transform = pipeline.transform;
	const f32 left = command.area.left * transform.scale + transform.offsetX;
	const f32 top = command.area.top * transform.scale + transform.offsetY;
	const f32 width = (command.area.right - command.area.left) * transform.scale;
	const f32 height = (command.area.bottom - command.area.top) * transform.scale;
	if (command.kind == RectRenderKind::Fill) {
		appendQuadGLES2(pipeline, left, top, width, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
		return;
	}
	appendQuadGLES2(pipeline, left, top, width, 1, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	appendQuadGLES2(pipeline, left, top + height - 1, width, 1, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	appendQuadGLES2(pipeline, left, top, 1, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
	appendQuadGLES2(pipeline, left + width - 1, top, 1, height, 0.0f, 0.0f, 1.0f, 1.0f, command.color);
}

void appendLineGLES2(HostOverlayGLES2State& pipeline, f32 x0, f32 y0, f32 x1, f32 y1, u32 color, f32 thickness) {
	const f32 dx = x1 - x0;
	const f32 dy = y1 - y0;
	if (dx == 0.0f && dy == 0.0f) {
		appendQuadGLES2(pipeline, static_cast<i32>(x0), static_cast<i32>(y0), static_cast<i32>(thickness), static_cast<i32>(thickness), 0.0f, 0.0f, 1.0f, 1.0f, color);
		return;
	}
	const f32 length = std::sqrt(dx * dx + dy * dy);
	const f32 half = thickness * 0.5f;
	const f32 normalX = -dy / length;
	const f32 normalY = dx / length;
	const float vertices[24] = {
		x0 - normalX * half, y0 - normalY * half, 0.0f, 0.0f,
		x0 + normalX * half, y0 + normalY * half, 0.0f, 1.0f,
		x1 - normalX * half, y1 - normalY * half, 1.0f, 0.0f,
		x1 - normalX * half, y1 - normalY * half, 1.0f, 0.0f,
		x0 + normalX * half, y0 + normalY * half, 0.0f, 1.0f,
		x1 + normalX * half, y1 + normalY * half, 1.0f, 1.0f,
	};
	pipeline.drawList.appendQuad(vertices, color);
}

void appendPolyGLES2(HostOverlayGLES2State& pipeline, const PolyRenderSubmission& command) {
	const auto& transform = pipeline.transform;
	for (size_t index = 0; index + 3u < command.points.size(); index += 2u) {
		appendLineGLES2(pipeline, command.points[index] * transform.scale + transform.offsetX, command.points[index + 1u] * transform.scale + transform.offsetY,
			command.points[index + 2u] * transform.scale + transform.offsetX, command.points[index + 3u] * transform.scale + transform.offsetY, command.color, command.thickness);
	}
}

void appendHostAtlasImageGLES2(HostOverlayGLES2State& pipeline, std::string_view imgid, f32 x, f32 y, f32 scaleX, f32 scaleY, const FlipOptions& flip, u32 color) {
	const HostSystemAtlasImage& source = hostSystemAtlasImage(imgid);
	const auto& transform = pipeline.transform;
	f32 u0 = static_cast<f32>(source.u) / static_cast<f32>(HOST_SYSTEM_ATLAS.width);
	f32 v0 = static_cast<f32>(source.v) / static_cast<f32>(HOST_SYSTEM_ATLAS.height);
	f32 u1 = static_cast<f32>(source.u + source.w) / static_cast<f32>(HOST_SYSTEM_ATLAS.width);
	f32 v1 = static_cast<f32>(source.v + source.h) / static_cast<f32>(HOST_SYSTEM_ATLAS.height);
	if (flip.flip_h) {
		const f32 swap = u0;
		u0 = u1;
		u1 = swap;
	}
	if (flip.flip_v) {
		const f32 swap = v0;
		v0 = v1;
		v1 = swap;
	}
	appendQuadGLES2(
		pipeline,
		x * transform.scale + transform.offsetX,
		y * transform.scale + transform.offsetY,
		static_cast<f32>(source.width) * scaleX * transform.scale,
		static_cast<f32>(source.height) * scaleY * transform.scale,
		u0,
		v0,
		u1,
		v1,
		color
	);
}

struct GlyphGLES2Context {
	HostOverlayGLES2State& pipeline;
	f32 uScale, vScale;
	f32 padding;
	f32 lineHeight;
	u32 color;
};

void appendGlyphGLES2(GlyphGLES2Context& context, const FontGlyph& item, f32 imageX, f32 imageY) {
	const ImageAtlasRect& rect = item.rect;
	if (rect.w == 0 || rect.h == 0) return;
	auto& pipeline = context.pipeline;
	const auto& transform = pipeline.transform;
	const f32 padding = context.padding;
	const f32 padX = padding * item.width / rect.w, padY = padding * item.height / rect.h;
	appendQuadGLES2(
		pipeline,
		(imageX + item.offsetX - padX) * transform.scale + transform.offsetX,
		(imageY + item.offsetY - padY) * transform.scale + transform.offsetY,
		(item.width + padX * 2) * transform.scale,
		(item.height + padY * 2) * transform.scale,
		(rect.u - padding) * context.uScale,
		(rect.v - padding) * context.vScale,
		(rect.u + rect.w + padding) * context.uScale,
		(rect.v + rect.h + padding) * context.vScale,
		context.color
	);
}

void appendGlyphBackgroundGLES2(
	GlyphGLES2Context& context,
	const FontGlyph& item,
	f32 imageX,
	f32 imageY
) {
	const auto& transform = context.pipeline.transform;
	appendQuadGLES2(
		context.pipeline,
		imageX * transform.scale + transform.offsetX,
		imageY * transform.scale + transform.offsetY,
		static_cast<f32>(item.advance) * transform.scale,
		static_cast<f32>(context.lineHeight) * transform.scale,
		0.0f,
		0.0f,
		1.0f,
		1.0f,
		context.color
	);
}

void appendGlyphsGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const GlyphRenderSubmission& command, HostOverlayGLES2DrawState state) {
	GlyphGLES2Context context{
		.pipeline = pipeline,
		.uScale = 1.0F / command.font->atlas.width,
		.vScale = 1.0F / command.font->atlas.height,
		.padding = command.font->raster == FontRaster::Bitmap && command.font->sampling == FontSampling::Linear ? 0.5F : 0.0F,
		.lineHeight = 0,
		.color = command.background_color,
	};
	if (command.has_background_color) {
		pipeline.drawList.setState(state);
		context.lineHeight = command.font->lineHeight();
		forEachBatchBlitGlyph(command, context, appendGlyphBackgroundGLES2);
	}
	auto& atlas = atlasTexture(backend, pipeline, command.font->atlas);
	state.texture = atlas.texture;
	state.atlas = &atlas;
	state.sampling = command.font->sampling;
	state.glyphMode = command.font->raster == FontRaster::Msdf ? 2 : command.font->sampling == FontSampling::Linear ? 1 : 0;
	if (command.font->raster == FontRaster::Msdf) {
		state.screenRange = std::max(1.0F, command.font->distanceRange * pipeline.transform.scale * pipeline.pixelScale);
	}
	pipeline.drawList.setState(state);
	context.color = command.color;
	forEachBatchBlitGlyph(command, context, appendGlyphGLES2);
}

} // namespace

void bootstrapHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline) {
	pipeline.generation = backend.contextGeneration();
	pipeline.program = backend.buildProgram(kHostOverlayVertexShader, kHostOverlayFragmentShader, "host_overlay");
	pipeline.attribPos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attribUv = glGetAttribLocation(pipeline.program, "a_texcoord");
	pipeline.attribColor = glGetAttribLocation(pipeline.program, "a_color");
	pipeline.uniformResolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniformGlyphMode = glGetUniformLocation(pipeline.program, "u_glyph_mode");
	pipeline.uniformScreenRange = glGetUniformLocation(pipeline.program, "u_screen_range");
	glUseProgram(pipeline.program);
	glUniform1i(glGetUniformLocation(pipeline.program, "u_texture"), GLES2_TEXTURE_UNIT_HOST_2D);
	glGenBuffers(1, &pipeline.vbo);
	const u8 whitePixel[4] = {255u, 255u, 255u, 255u};
	pipeline.whiteTexture = backend.createTexture(whitePixel, 1, 1, RGBA8_LINEAR_TEXTURE_PARAMS);
}

void shutdownHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline) {
	if (pipeline.generation == backend.contextGeneration()) {
		glDeleteProgram(pipeline.program);
		glDeleteBuffers(1, &pipeline.vbo);
	}
	backend.destroyTexture(pipeline.whiteTexture);
	for (const auto& [atlas, entry] : pipeline.atlases) backend.destroyTexture(entry.texture);
	pipeline = HostOverlayGLES2State{};
}

void beginHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const Host2DPipelineState& state) {
	pipeline.drawList.reset();
	pipeline.frameTexture = state.frameTexture;
	pipeline.transform = IDENTITY_HOST_OVERLAY_TRANSFORM;
	backend.setRenderTarget(backend.backbuffer(), state.width, state.height);
	glViewport(0, 0, state.width, state.height);
	pipeline.targetHeight = state.height;
	pipeline.pixelScale = 0.5F * (static_cast<f32>(state.width) / state.overlayWidth + static_cast<f32>(state.height) / state.overlayHeight);
	pipeline.clip.reset(state.overlayWidth, state.overlayHeight, state.width, state.height);
	glEnable(GL_SCISSOR_TEST);
	glScissor(0, 0, state.width, state.height);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glEnable(GL_BLEND);
	glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
	glUseProgram(pipeline.program);
	glUniform2f(pipeline.uniformResolution, static_cast<float>(state.overlayWidth), static_cast<float>(state.overlayHeight));
}

void renderHost2DEntryGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, Host2DKind kind, Host2DRef ref) {
	if (kind == Host2DKind::Transform) {
		pipeline.transform = *ref.transform;
		return;
	}
	if (kind == Host2DKind::Clip) {
		pipeline.clip.set(*ref.clip);
		return;
	}
	const auto& clip = pipeline.clip;
	HostOverlayGLES2DrawState state{
		.texture = pipeline.whiteTexture,
		.scissor = {clip.left, pipeline.targetHeight - clip.bottom, clip.right - clip.left, clip.bottom - clip.top},
	};
	if (kind == Host2DKind::Glyphs) {
		appendGlyphsGLES2(backend, pipeline, *ref.glyphs, state);
		return;
	}
	if (kind == Host2DKind::Img) {
		auto& atlas = atlasTexture(backend, pipeline, HOST_SYSTEM_ATLAS);
		state.texture = atlas.texture;
		state.atlas = &atlas;
	} else if (kind == Host2DKind::Frame) {
		state.texture = pipeline.frameTexture;
	}
	pipeline.drawList.setState(state);
	switch (kind) {
		case Host2DKind::Img: {
			const auto& command = *ref.img;
			appendHostAtlasImageGLES2(pipeline, command.imgid, command.pos.x, command.pos.y, command.scale.x, command.scale.y, command.flip, command.colorize);
			return;
		}
		case Host2DKind::Frame: {
			const auto& area = ref.frame->area;
			const auto& transform = pipeline.transform;
			appendQuadGLES2(pipeline,
				area.left * transform.scale + transform.offsetX, area.top * transform.scale + transform.offsetY,
				(area.right - area.left) * transform.scale, (area.bottom - area.top) * transform.scale,
				0, 1, 1, 0, 0xffffffffu);
			return;
		}
		case Host2DKind::Rect: appendRectGLES2(pipeline, *ref.rect); return;
		case Host2DKind::Poly: appendPolyGLES2(pipeline, *ref.poly); return;
		case Host2DKind::Glyphs:
		case Host2DKind::Clip:
		case Host2DKind::Transform: return;
	}
}

void endHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline) {
	const auto& list = pipeline.drawList;
	if (!list.vertices.empty()) {
		glBindBuffer(GL_ARRAY_BUFFER, pipeline.vbo);
		glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(list.vertices.size() * sizeof(HostOverlayGLES2Vertex)), list.vertices.data(), GL_STREAM_DRAW);
		glEnableVertexAttribArray(static_cast<GLuint>(pipeline.attribPos));
		glVertexAttribPointer(static_cast<GLuint>(pipeline.attribPos), 2, GL_FLOAT, GL_FALSE, sizeof(HostOverlayGLES2Vertex), nullptr);
		glEnableVertexAttribArray(static_cast<GLuint>(pipeline.attribUv));
		glVertexAttribPointer(static_cast<GLuint>(pipeline.attribUv), 2, GL_FLOAT, GL_FALSE, sizeof(HostOverlayGLES2Vertex), reinterpret_cast<const void*>(offsetof(HostOverlayGLES2Vertex, u)));
		glEnableVertexAttribArray(static_cast<GLuint>(pipeline.attribColor));
		glVertexAttribPointer(static_cast<GLuint>(pipeline.attribColor), 4, GL_UNSIGNED_BYTE, GL_TRUE, sizeof(HostOverlayGLES2Vertex), reinterpret_cast<const void*>(offsetof(HostOverlayGLES2Vertex, color)));
		const HostOverlayGLES2DrawState* previous = nullptr;
		for (const auto& batch : list.batches) {
			if (batch.count == 0) continue;
			const auto& state = batch.state;
			bindTexture(backend, state.texture);
			// ES2 filtering is texture state. Apply it in draw order, not while
			// collecting a later command that may use the same atlas differently.
			if (state.atlas && state.atlas->sampling != state.sampling) {
				glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, state.sampling == FontSampling::Linear ? GL_LINEAR : GL_NEAREST);
				glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, state.sampling == FontSampling::Linear ? GL_LINEAR : GL_NEAREST);
				state.atlas->sampling = state.sampling;
			}
			if (!previous || state.glyphMode != previous->glyphMode) glUniform1i(pipeline.uniformGlyphMode, state.glyphMode);
			if (state.glyphMode == 2 && (!previous || previous->glyphMode != 2 || state.screenRange != previous->screenRange)) {
				glUniform1f(pipeline.uniformScreenRange, state.screenRange);
			}
			if (!previous || state.scissor != previous->scissor) {
				glScissor(state.scissor[0], state.scissor[1], state.scissor[2], state.scissor[3]);
			}
			glDrawArrays(GL_TRIANGLES, batch.first, batch.count);
			previous = &state;
		}
	}
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_BLEND);
	glDepthMask(GL_TRUE);
}

} // namespace bmsx
#endif
