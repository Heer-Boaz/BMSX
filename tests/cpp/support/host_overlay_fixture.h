#pragma once

#include "render/host_overlay/commands.h"
#include "render/shared/bmsx_font.h"
#include "render/shared/submissions.h"
#include <array>

namespace bmsx::test {

// Same primitive corpus as tests/helpers/host_overlay_primitives.ts.
struct HostOverlayFixture {
	Font font{FontVariant::Tiny};
	RectRenderSubmission fill;
	RectRenderSubmission stroke;
	PolyRenderSubmission poly;
	PolyRenderSubmission fractionalPoly;
	HostImageRenderSubmission image;
	GlyphRenderSubmission glyphs;
	const std::array<Host2DKind, 6> kinds{Host2DKind::Rect, Host2DKind::Rect, Host2DKind::Poly, Host2DKind::Poly, Host2DKind::Img, Host2DKind::Glyphs};
	const std::array<Host2DRef, 6> refs{{{.rect = &fill}, {.rect = &stroke}, {.poly = &poly}, {.poly = &fractionalPoly}, {.img = &image}, {.glyphs = &glyphs}}};

	HostOverlayFixture() {
		fill.kind = RectRenderKind::Fill;
		fill.area = {.left = 2, .top = 3, .right = 60, .bottom = 44};
		stroke.kind = RectRenderKind::Rect;
		stroke.area = {.left = 8, .top = 12, .right = 48, .bottom = 39};
		poly.points = {0, 1, 60, 42, 60, 20, 0, 20};
		poly.thickness = 3;
		fractionalPoly.points = {-3.5F, 2.5F, 60.9F, 40.4F};
		fractionalPoly.thickness = 2.5F;
		image.imgid = font.getGlyph('A').imgid;
		image.pos = {.x = 7, .y = 5};
		image.scale = {.x = 8, .y = 8};
		image.flip = {.flip_h = true, .flip_v = true};
		glyphs.x = 8;
		glyphs.y = 7;
		glyphs.font = &font;
		glyphs.items = {"ABCDEFGHIJ\nKLMNOPQRST\nUVWXYZ"};
		glyphs.item_end = 28;
		glyphs.has_background_color = true;
		glyphs.background_color = 0xff223344;
	}
};

} // namespace bmsx::test
