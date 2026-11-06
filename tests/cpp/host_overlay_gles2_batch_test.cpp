#include "render/host_overlay/gles2/pipeline.h"
#include "render/shared/bmsx_font.h"
#include "render/shared/submissions.h"
#include "support/host_font_atlas_fixture.h"
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

namespace {

// Observe real driver calls, not counters or APIs added to the renderer for tests.
struct Calls {
	size_t uploads = 0, bytes = 0, draws = 0, vertices = 0, filters = 0;
} calls;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

} // namespace

extern "C" {
void __real_glBufferData(GLenum, GLsizeiptr, const void*, GLenum);
void __wrap_glBufferData(GLenum target, GLsizeiptr size, const void* data, GLenum usage) {
	++calls.uploads;
	calls.bytes += size;
	__real_glBufferData(target, size, data, usage);
}
void __real_glDrawArrays(GLenum, GLint, GLsizei);
void __wrap_glDrawArrays(GLenum mode, GLint first, GLsizei count) {
	++calls.draws;
	calls.vertices += count;
	__real_glDrawArrays(mode, first, count);
}
void __real_glTexParameteri(GLenum, GLenum, GLint);
void __wrap_glTexParameteri(GLenum target, GLenum parameter, GLint value) {
	if (parameter == GL_TEXTURE_MIN_FILTER || parameter == GL_TEXTURE_MAG_FILTER) ++calls.filters;
	__real_glTexParameteri(target, parameter, value);
}
}

void testHostOverlayGLES2Batches(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const Host2DPipelineState& state) {
	test::HostFontAtlasFixture source(false, false);
	BFont font(source, {{'A', "fixture"}, {'?', "fixture"}});
	GlyphRenderSubmission text;
	text.font = &font; text.items = {std::string(1024, 'A')}; text.item_end = 1024;
	text.x = 1; text.y = 1;
	GlyphRenderSubmission red, green;
	red.font = green.font = &font; red.items = green.items = {"A"}; red.item_end = green.item_end = 1;
	red.x = 2; green.x = 8; red.y = green.y = 8;
	red.color = 0xffff0000; green.color = 0xff00ff00;
	const HostOverlayGLES2Vertex* retainedVertices = nullptr;
	const HostOverlayGLES2Batch* retainedBatches = nullptr;
	std::vector<u8> pixels(state.width * state.height * 4);
	for (int repeat = 0; repeat < 3; ++repeat) {
		calls = {};
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &text});
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &red});
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &green});
		endHostOverlayGLES2(backend, pipeline);
		require(calls.uploads == 1 && calls.draws == 1, "adjacent glyph runs upload once and draw once, including different colors");
		require(calls.vertices == 1026 * 6 && calls.bytes == calls.vertices * sizeof(HostOverlayGLES2Vertex), "batch contains every glyph exactly once");
		if (repeat == 0) {
			retainedVertices = pipeline.drawList.vertices.data(); retainedBatches = pipeline.drawList.batches.data();
		} else {
			require(retainedVertices == pipeline.drawList.vertices.data() && retainedBatches == pipeline.drawList.batches.data(), "draw-list storage is reused across passes");
			require(calls.filters == 0, "repeated nearest glyph runs do not rewrite sampler state");
		}
		glReadPixels(0, 0, state.width, state.height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
		for (int i = 0; i < 2; ++i) {
			const int offset = ((state.height - 1 - 8) * state.width + (i == 0 ? 2 : 8)) * 4;
			require(pixels[offset] == (i == 0 ? 255 : 0) && pixels[offset + 1] == (i == 1 ? 255 : 0)
				&& pixels[offset + 2] == 0 && pixels[offset + 3] == 255, "batch tint belongs to each primitive, not the last command");
		}
	}
	std::cout << "HOST-OVERLAY-BATCH:1026 glyphs, " << calls.uploads << " upload, " << calls.draws << " draw\n";

	// An ES2 draw list must not silently acquire the 16-bit index ceiling.
	text.items = {std::string(16385, 'A')}; text.item_end = 16385;
	calls = {};
	beginHostOverlayGLES2(backend, pipeline, state);
	renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &text});
	endHostOverlayGLES2(backend, pipeline);
	require(calls.draws == 1 && calls.uploads == 1 && calls.vertices == 16385 * 6, "large glyph lists keep every vertex without an ES3 index extension");
	retainedVertices = pipeline.drawList.vertices.data();
	calls = {};
	beginHostOverlayGLES2(backend, pipeline, state);
	endHostOverlayGLES2(backend, pipeline);
	require(calls.uploads == 0 && calls.draws == 0, "empty passes do not replay retained geometry or upload buffers");
	require(retainedVertices == pipeline.drawList.vertices.data(), "empty passes retain vertex capacity");

	Font nearest(FontVariant::Tiny), smooth(FontVariant::Tiny, FontStyle::Normal, FontSampling::Linear), scalable(FontVariant::Mono);
	GlyphRenderSubmission bitmap, coverage, msdf;
	bitmap.font = &nearest; coverage.font = &smooth; msdf.font = &scalable;
	bitmap.items = coverage.items = msdf.items = {"Ag"}; bitmap.item_end = coverage.item_end = msdf.item_end = 2;
	bitmap.x = coverage.x = msdf.x = 4; bitmap.y = coverage.y = msdf.y = 3;
	bitmap.color = 0xc01080ff; coverage.color = 0xa080ff40; msdf.color = 0xb0ffa020;
	coverage.has_background_color = msdf.has_background_color = true;
	coverage.background_color = msdf.background_color = 0x40202080;
	const HostOverlayTransform small{1.5F, 1.25F, 2.5F}, large{3.0F, 12, 10};
	const HostOverlayClipRect full{0, 0, state.overlayWidth, state.overlayHeight}, crop{10, 8, 40, 30}, empty{20, 10, 20, 20};
	const RectRenderSubmission rect{RectRenderKind::Fill, {3, 4, 40, 32, 0}, 0x804020ff, Layer2D::IDE};
	HostImageRenderSubmission image;
	image.imgid = nearest.getGlyph('A').imgid; image.pos = {.x = 20, .y = 10}; image.scale = {.x = 3, .y = 3};
	const HostFrameRenderSubmission frame{{8, 12, 48, 44, 0}};
	const PolyRenderSubmission line{.points = {1, 2, 40, 30}, .color = 0x80f04020, .thickness = 2, .layer = Layer2D::IDE};
	struct Entry { Host2DKind kind; Host2DRef ref; };
	const Entry entries[]{
		{Host2DKind::Rect, {.rect = &rect}},
		{Host2DKind::Transform, {.transform = &small}},
		{Host2DKind::Glyphs, {.glyphs = &coverage}},
		{Host2DKind::Img, {.img = &image}},
		{Host2DKind::Clip, {.clip = &crop}},
		{Host2DKind::Glyphs, {.glyphs = &msdf}},
		{Host2DKind::Transform, {.transform = &large}},
		{Host2DKind::Glyphs, {.glyphs = &msdf}},
		{Host2DKind::Clip, {.clip = &empty}},
		{Host2DKind::Rect, {.rect = &rect}},
		{Host2DKind::Clip, {.clip = &full}},
		{Host2DKind::Transform, {.transform = &IDENTITY_HOST_OVERLAY_TRANSFORM}},
		{Host2DKind::Frame, {.frame = &frame}},
		{Host2DKind::Glyphs, {.glyphs = &bitmap}},
		{Host2DKind::Poly, {.poly = &line}},
		{Host2DKind::Glyphs, {.glyphs = &coverage}},
	};
	// Completing each primitive in its own pass provides an unbatched reference
	// for draw order, clipping, uniforms and ES2's per-texture filter mutation.
	std::vector<u8> unbatched(pixels.size());
	for (bool batched : {false, true}) {
		HostOverlayTransform transform = IDENTITY_HOST_OVERLAY_TRANSFORM;
		HostOverlayClipRect clip = full;
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
		if (!batched) endHostOverlayGLES2(backend, pipeline);
		calls = {};
		for (const auto& entry : entries) {
			if (batched) {
				renderHost2DEntryGLES2(backend, pipeline, entry.kind, entry.ref);
			} else if (entry.kind == Host2DKind::Transform) {
				transform = *entry.ref.transform;
			} else if (entry.kind == Host2DKind::Clip) {
				clip = *entry.ref.clip;
			} else {
				beginHostOverlayGLES2(backend, pipeline, state);
				renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &transform});
				renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = &clip});
				renderHost2DEntryGLES2(backend, pipeline, entry.kind, entry.ref);
				endHostOverlayGLES2(backend, pipeline);
			}
		}
		if (batched) {
			endHostOverlayGLES2(backend, pipeline);
			require(calls.uploads == 1, "mixed primitives still share one vertex upload");
		}
		glReadPixels(0, 0, state.width, state.height, GL_RGBA, GL_UNSIGNED_BYTE, batched ? pixels.data() : unbatched.data());
	}
	require(pixels == unbatched, "batching preserves mixed primitive pixels, blending order, clip, screen range and sampling");
	require(glGetError() == GL_NO_ERROR, "batched host overlay graphics error");
}
