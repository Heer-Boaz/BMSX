#include "render/host_overlay/atlas.h"
#include "render/shared/bmsx_font.h"
#include <array>
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
		const std::array<std::string, 3> suffixes{"_bold", "_italic", "_bold-italic"};
		const std::array<bmsx::FontStyle, 3> styles{bmsx::FontStyle::Bold, bmsx::FontStyle::Italic, bmsx::FontStyle::BoldItalic};
		for (std::size_t index = 0; index < styles.size(); ++index) {
			bmsx::Font font(variant, styles[index]);
			const bool bold = index != 1, italic = index != 0;
			require(font.lineHeight() == normal.lineHeight(), "styled fonts preserve the baseline");
			for (bmsx::u32 code = 32; code <= 126; ++code) {
				const auto& base = normal.getGlyph(code);
				const auto& glyph = font.getGlyph(code);
				require(glyph.imgid == base.imgid + suffixes[index], "native styled font selects its baked glyph");
				require(glyph.width == base.width + (bold ? 1 : 0) + (italic ? (base.height - 1) >> 2 : 0), "styled font width");
				require(glyph.height == base.height, "styled font height");
				for (int y = 0; y < glyph.height; ++y) {
					std::vector<bmsx::u8> row(glyph.width);
					const int shift = italic ? (base.height - 1 - y) >> 2 : 0;
					for (int x = 0; x < base.width; ++x) {
						const auto alpha = bmsx::HOST_SYSTEM_ATLAS.pixels[((base.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + base.rect.u + x) * 4u + 3u];
						row[x + shift] |= alpha;
						if (bold) row[x + shift + 1] |= alpha;
					}
					for (int x = 0; x < glyph.width; ++x) {
						require(bmsx::HOST_SYSTEM_ATLAS.pixels[((glyph.rect.v + y) * bmsx::HOST_SYSTEM_ATLAS.width + glyph.rect.u + x) * 4u + 3u] == row[x], "native font style has the expected baked pixels");
					}
				}
			}
		}
	}
	return 0;
}
