#include "render/host_overlay/atlas.h"
#include "render/shared/bmsx_font.h"
#include <vector>

#include <cstddef>
#include <stdexcept>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

} // namespace

int main() {
	require(
		bmsx::HOST_SYSTEM_ATLAS.pixels.size()
			== static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.width) * static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.height) * 4u,
		"host system atlas pixel span should match its dimensions");
	require(!bmsx::HOST_SYSTEM_ATLAS.images.empty(), "host system atlas should contain image descriptors");
	for (std::size_t index = 1u; index < bmsx::HOST_SYSTEM_ATLAS.images.size(); index += 1u) {
		require(
			bmsx::HOST_SYSTEM_ATLAS.images[index - 1u].id < bmsx::HOST_SYSTEM_ATLAS.images[index].id,
			"host system atlas image descriptors should be sorted by id");
	}

	const bmsx::HostSystemAtlasImage& whitePixel = bmsx::hostSystemAtlasImage("whitepixel");
	const std::size_t whitePixelOffset = (
		static_cast<std::size_t>(whitePixel.v) * static_cast<std::size_t>(bmsx::HOST_SYSTEM_ATLAS.width)
		+ static_cast<std::size_t>(whitePixel.u)
	) * 4u;
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset] == 0xffu, "white pixel red channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 1u] == 0xffu, "white pixel green channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 2u] == 0xffu, "white pixel blue channel should be opaque white");
	require(bmsx::HOST_SYSTEM_ATLAS.pixels[whitePixelOffset + 3u] == 0xffu, "white pixel alpha channel should be opaque white");

	bool missingImageRejected = false;
	try {
		(void)bmsx::hostSystemAtlasImage("missing_host_atlas_image");
	} catch (const std::runtime_error&) {
		missingImageRejected = true;
	}
	require(missingImageRejected, "host system atlas lookup should reject missing image ids");
	for (auto variant : {bmsx::FontVariant::Msx, bmsx::FontVariant::Tiny}) {
		bmsx::Font normal(variant);
		const auto& cell = normal.getGlyph(static_cast<bmsx::u32>('.'));
		for (auto style : {bmsx::FontStyle::Normal, bmsx::FontStyle::Italic}) {
			bmsx::Font symbols(variant, style);
			const auto& ellipsis = symbols.getGlyph(0x2026u);
			require(ellipsis.imgid != symbols.getGlyph(static_cast<bmsx::u32>('?')).imgid, "ellipsis must not use the fallback glyph");
			require(ellipsis.imgid.find("_ellipsis") != std::string::npos, "ellipsis uses one native atlas glyph");
			require(ellipsis.height == symbols.lineHeight(), "ellipsis preserves the font baseline");
			require(ellipsis.advance < symbols.advance('.') * 3, "ellipsis is narrower than three dot glyphs");
			require(symbols.measure("\xe2\x80\xa6") == ellipsis.advance, "UTF-8 text measures one ellipsis glyph");
			int opaque = 0;
			for (int y = 0; y < ellipsis.height; ++y) {
				for (int x = 0; x < ellipsis.width; ++x) {
					if (bmsx::HOST_SYSTEM_ATLAS.pixels[((ellipsis.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + ellipsis.rect.u + x) * 4u + 3u] != 0) ++opaque;
				}
			}
			require(opaque == 3, "one ellipsis glyph contains three single-pixel dots");
			const auto& middleDot = symbols.getGlyph(0x00b7u);
			const auto& fallback = symbols.getGlyph(static_cast<bmsx::u32>('?'));
			require(middleDot.imgid != fallback.imgid, "middle dot must not use the fallback glyph");
			require(middleDot.width == cell.width + (style == bmsx::FontStyle::Italic ? (cell.height - 1) >> 2 : 0), "middle dot uses the period cell and italic extent");
			require(middleDot.height == cell.height && middleDot.height == symbols.lineHeight(), "middle dot preserves the font baseline");
			require(middleDot.advance == symbols.advance('.'), "middle dot advances one period cell");
			// The bitmap contract is independent of atlas packing and UI placement.
			const int dotY = (cell.height - 2) >> 1;
			const int dotX = ((cell.width - 1) >> 1) + (style == bmsx::FontStyle::Italic ? (cell.height - 1 - dotY) >> 2 : 0);
			for (int y = 0; y < middleDot.height; ++y) {
				for (int x = 0; x < middleDot.width; ++x) {
					const std::size_t offset = ((middleDot.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + middleDot.rect.u + x) * 4u;
					const bool dot = x == dotX && y == dotY;
					require(bmsx::HOST_SYSTEM_ATLAS.pixels[offset + 3u] == (dot ? 255 : 0), "middle dot raster contains one centered opaque pixel through glyph UV");
					if (dot) require(bmsx::HOST_SYSTEM_ATLAS.pixels[offset] == 255 && bmsx::HOST_SYSTEM_ATLAS.pixels[offset + 1u] == 255
						&& bmsx::HOST_SYSTEM_ATLAS.pixels[offset + 2u] == 255, "middle dot raster pixel is white");
				}
			}
			require(symbols.measure("\xc2\xb7") == middleDot.advance, "UTF-8 text measures one middle dot glyph");
			require(symbols.measure("A\xc2\xb7" "B") == symbols.advance('A') + middleDot.advance + symbols.advance('B'), "UTF-8 middle dot advances once between surrounding glyphs");
			require(&symbols.getGlyph(0x00b7u) == &middleDot, "middle dot geometry is retained across text measurement");
			const auto& unknown = symbols.getGlyph(0x2603u);
			require(unknown.imgid == fallback.imgid && unknown.advance == fallback.advance, "unmapped Unicode still resolves the ordinary question glyph");
			require(unknown.rect.u == fallback.rect.u && unknown.rect.v == fallback.rect.v && unknown.rect.w == fallback.rect.w && unknown.rect.h == fallback.rect.h,
				"unmapped Unicode preserves fallback atlas UV");
			require(symbols.measure("A\xe2\x98\x83" "B") == symbols.advance('A') + fallback.advance + symbols.advance('B'), "unmapped UTF-8 still advances once through fallback");
		}
		bmsx::Font font(variant, bmsx::FontStyle::Italic);
		require(font.lineHeight() == normal.lineHeight(), "italic fonts preserve the baseline");
		for (bmsx::u32 code = 32; code <= 126; ++code) {
			const auto& base = normal.getGlyph(code);
			const auto& glyph = font.getGlyph(code);
			require(glyph.width == base.width + ((base.height - 1) >> 2), "italic font width");
			require(glyph.height == base.height, "italic font height");
			for (int y = 0; y < glyph.height; ++y) {
				std::vector<bmsx::u8> row(glyph.width);
				const int shift = (base.height - 1 - y) >> 2;
				for (int x = 0; x < base.width; ++x) {
					row[x + shift] = bmsx::HOST_SYSTEM_ATLAS.pixels[((base.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + base.rect.u + x) * 4u + 3u];
				}
				for (int x = 0; x < glyph.width; ++x) {
					require(bmsx::HOST_SYSTEM_ATLAS.pixels[((glyph.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4u + 3u] == row[x], "native italic glyph contains the sheared source pixels");
				}
			}
		}
	}
	return 0;
}
