#include "render/host_overlay/clip.h"
#include "render/host_overlay/software/renderer.h"
#include "support/host_overlay_fixture.h"
#include "spec/bmsx/model.h"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int main() {
	HostOverlayClipState scissor;
	const HostOverlayClipRect clip{11, 9, 43, 34};
	scissor.reset(64, 48, 160, 120);
	scissor.set(clip);
	require(scissor.left == 27 && scissor.top == 22 && scissor.right == 107 && scissor.bottom == 85, "logical scissor mapping");
	scissor.set({-30, -20, 100, 100});
	require(scissor.left == 0 && scissor.top == 0 && scissor.right == 160 && scissor.bottom == 120, "scissor target intersection");
	scissor.set({80, 30, 90, 20});
	require(scissor.left == 160 && scissor.top == 75 && scissor.right == 160 && scissor.bottom == 75, "empty scissor intersection");

	SoftwareBackend backend(64, 48, PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(64, 48);
	Host2DPipelineState state;
	state.width = state.overlayWidth = 64;
	state.height = state.overlayHeight = 48;
	test::HostOverlayFixture fixture;
	std::vector<u32> reference(64 * 48);
	for (const HostOverlayTransform transform : {IDENTITY_HOST_OVERLAY_TRANSFORM, HostOverlayTransform{0.5F, 3, 2}, HostOverlayTransform{2, 3, 2}}) {
		for (size_t index = 0; index < fixture.kinds.size(); ++index) {
			std::fill_n(backend.framebuffer(), reference.size(), 0);
			beginHostOverlaySoftware(backend, state);
			renderHost2DEntrySoftware(backend, Host2DKind::Transform, {.transform = &transform});
			renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
			std::copy_n(backend.framebuffer(), reference.size(), reference.begin());
			std::fill_n(backend.framebuffer(), reference.size(), 0);
			renderHost2DEntrySoftware(backend, Host2DKind::Clip, {.clip = &clip});
			renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
			int lit = 0;
			for (int y = 0; y < 48; ++y) {
				for (int x = 0; x < 64; ++x) {
					const bool inside = x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom;
					const size_t offset = static_cast<size_t>(y * 64 + x);
					require(backend.framebuffer()[offset] == (inside ? reference[offset] : 0), "clipping must crop, not reposition or resample");
					lit += backend.framebuffer()[offset] != 0;
				}
			}
			require(lit > 0, "fixture must have partially visible pixels");
			endHostOverlaySoftware(backend);
			require(backend.hostOverlayClip.left == 0 && backend.hostOverlayClip.right == 64, "pass end releases the scissor");
		}
	}
	for (const auto variant : {FontVariant::Msx, FontVariant::Tiny}) {
		for (const auto style : {FontStyle::Normal, FontStyle::Italic}) {
			Font font(variant, style);
			GlyphRenderSubmission text;
			text.font = &font;
			text.items = {"true\tgy\nfalse\ntrue"}; text.item_end = 18;
			text.has_background_color = true; text.background_color = 0xff223344;
			const HostOverlayTransform scale{2, 0, 0};
			for (const f32 phase : {0.0F, 0.25F, 0.5F, 0.75F}) {
				text.x = 2 + phase; text.y = 3 + phase;
				std::fill_n(backend.framebuffer(), reference.size(), 0);
				beginHostOverlaySoftware(backend, state);
				renderHost2DEntrySoftware(backend, Host2DKind::Transform, {.transform = &scale});
				renderHost2DEntrySoftware(backend, Host2DKind::Clip, {.clip = &clip});
				renderHost2DEntrySoftware(backend, Host2DKind::Glyphs, {.glyphs = &text});
				if (phase == 0) std::copy_n(backend.framebuffer(), reference.size(), reference.begin());
				else require(std::equal(reference.begin(), reference.end(), backend.framebuffer()),
					"bitmap run origin must align before magnification, including text backgrounds");
				endHostOverlaySoftware(backend);
			}
		}
	}
	fixture.glyphs.x = 2;
	fixture.glyphs.y = 3;
	fixture.glyphs.items = {"A\tB\nC"};
	fixture.glyphs.item_end = 5;
	const HostOverlayTransform doubled{2, 0, 0};
	std::fill_n(backend.framebuffer(), reference.size(), 0);
	beginHostOverlaySoftware(backend, state);
	require(backend.hostOverlayTransform.scaleX == 1 && backend.hostOverlayTransform.scaleY == 1
		&& backend.hostOverlayTransform.offsetX == 0, "new pass resets transform");
	renderHost2DEntrySoftware(backend, Host2DKind::Glyphs, {.glyphs = &fixture.glyphs});
	std::copy_n(backend.framebuffer(), reference.size(), reference.begin());
	std::fill_n(backend.framebuffer(), reference.size(), 0);
	renderHost2DEntrySoftware(backend, Host2DKind::Transform, {.transform = &doubled});
	renderHost2DEntrySoftware(backend, Host2DKind::Glyphs, {.glyphs = &fixture.glyphs});
	for (int y = 0; y < 48; ++y) {
		for (int x = 0; x < 64; ++x) {
			require(backend.framebuffer()[y * 64 + x] == reference[(y / 2) * 64 + x / 2], "2x glyph geometry must reproduce each texel including tabs, newlines and backgrounds");
		}
	}
	endHostOverlaySoftware(backend);
	// Viewport projection is independent of a control's logical transform.
	const HostOverlayTransform scope{2, 3, 2};
	for (size_t index = 0; index < fixture.kinds.size(); ++index) {
		backend.resizePresentationTarget(64, 48);
		std::fill_n(backend.framebuffer(), 64 * 48, 0);
		state.width = 64; state.height = 48;
		beginHostOverlaySoftware(backend, state);
		renderHost2DEntrySoftware(backend, Host2DKind::Transform, {.transform = &scope});
		renderHost2DEntrySoftware(backend, Host2DKind::Clip, {.clip = &clip});
		renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
		std::copy_n(backend.framebuffer(), reference.size(), reference.begin());
		endHostOverlaySoftware(backend);
		backend.resizePresentationTarget(128, 144);
		std::fill_n(backend.framebuffer(), 128 * 144, 0);
		state.width = 128; state.height = 144;
		beginHostOverlaySoftware(backend, state);
		renderHost2DEntrySoftware(backend, Host2DKind::Transform, {.transform = &scope});
		renderHost2DEntrySoftware(backend, Host2DKind::Clip, {.clip = &clip});
		renderHost2DEntrySoftware(backend, fixture.kinds[index], fixture.refs[index]);
		for (i32 y = 0; y < 144; y++) for (i32 x = 0; x < 128; x++) {
			require(backend.framebuffer()[y * 128 + x] == reference[(y / 3) * 64 + x / 2],
				"non-uniform frame projection scales logical raster and scissor together");
		}
		endHostOverlaySoftware(backend);
	}
	std::cout << "HOST-OVERLAY-CLIP:PASS\n";
}
