/*
 * glyphs.cpp - Glyph rendering utilities
 */

#include "glyphs.h"
#include "gameview.h"
#include "../core/font.h"
#include <cctype>
#include <limits>
#include <stdexcept>

namespace bmsx {
namespace {

u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	u8 c0 = static_cast<u8>(text.at(index++));
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		u8 c2 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	u8 c1 = static_cast<u8>(text.at(index++));
	u8 c2 = static_cast<u8>(text.at(index++));
	u8 c3 = static_cast<u8>(text.at(index++));
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

void renderGlyphSpan(GameView* view, const std::string& text, i32 start, i32 end, f32& x, f32& y,
					 f32 startX, f32& stepY, f32 z, BFont* font, const std::optional<Color>& color,
					 const std::optional<Color>& backgroundColor, const std::optional<RenderLayer>& layer) {
	ImgRenderSubmission spriteOptions;
	spriteOptions.imgid = "none";
	spriteOptions.pos = {x, y, z};
	spriteOptions.colorize = color;
	spriteOptions.layer = layer;

	RectRenderSubmission rectOptions;
	rectOptions.kind = RectRenderSubmission::Kind::Fill;
	rectOptions.color = backgroundColor.value_or(Color::transparent());
	rectOptions.layer = layer;

	size_t byteIndex = 0;
	i32 glyphIndex = 0;
	const i32 endIndex = end;

	while (byteIndex < text.size()) {
		u32 codepoint = readUtf8Codepoint(text, byteIndex);
		if (glyphIndex < start) {
			++glyphIndex;
			continue;
		}
		if (glyphIndex >= endIndex) {
			break;
		}

		const FontGlyph& glyph = font->getGlyph(codepoint);
		f32 stepX = static_cast<f32>(glyph.advance);
		f32 height = static_cast<f32>(glyph.height);
		if (height > stepY) {
			stepY = height;
		}

		if (backgroundColor) {
			RectBounds& area = rectOptions.area;
			area.left = x;
			area.top = y;
			area.right = x + stepX;
			area.bottom = y + stepY;
			view->renderer.submit.rect(rectOptions);
		}

		spriteOptions.pos.x = x;
		spriteOptions.pos.y = y;
		spriteOptions.imgid = glyph.imgid;
		view->renderer.submit.sprite(spriteOptions);

		x += stepX;
		++glyphIndex;
	}

	x = startX;
	y += stepY;
	stepY = 0.0f;
}

} // namespace

void renderGlyphs(GameView* view,
				  f32 x,
				  f32 y,
				  const std::vector<std::string>& lines,
				  std::optional<i32> start,
				  std::optional<i32> end,
				  f32 z,
				  BFont* font,
				  const std::optional<Color>& color,
				  const std::optional<Color>& backgroundColor,
				  const std::optional<RenderLayer>& layer) {
	if (!font) {
		throw BMSX_RUNTIME_ERROR("No font or default font available for renderGlyphs");
	}
	const f32 startX = x;
	f32 stepY = 0.0f;
	const i32 startIndex = start.value_or(0);
	const i32 endIndex = end.value_or(std::numeric_limits<i32>::max());
	for (const auto& line : lines) {
		renderGlyphSpan(view, line, startIndex, endIndex, x, y, startX, stepY,
						z, font, color, backgroundColor, layer);
		if (y >= view->canvasSize.y) {
			return;
		}
	}
}

f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth) {
	size_t longest = 0;
	for (const auto& line : lines) {
		if (line.size() > longest) {
			longest = line.size();
		}
	}
	i32 longestLineWidth = static_cast<i32>(longest) * charWidth;
	return static_cast<f32>(blockWidth - longestLineWidth) / 2.0f;
}

std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength) {
	std::vector<std::string> words;
	words.reserve(text.size());

	size_t index = 0;
	while (index < text.size()) {
		char c = text[index];
		if (c == '\n') {
			words.emplace_back("\n");
			++index;
			continue;
		}
		if (std::isspace(static_cast<unsigned char>(c))) {
			++index;
			continue;
		}
		size_t start = index;
		while (index < text.size()) {
			char ch = text[index];
			if (ch == '\n' || std::isspace(static_cast<unsigned char>(ch))) {
				break;
			}
			++index;
		}
		words.emplace_back(text.substr(start, index - start));
	}

	std::vector<std::string> lines;
	std::string currentLine;

	for (const auto& word : words) {
		if (word == "\n") {
			lines.push_back(currentLine);
			currentLine.clear();
			continue;
		}
		if (currentLine.empty()) {
			currentLine = word;
			continue;
		}
		std::string tentative = currentLine + " " + word;
		if (static_cast<i32>(tentative.size()) <= maxLineLength) {
			currentLine = std::move(tentative);
		} else {
			lines.push_back(currentLine);
			currentLine = word;
		}
	}

	if (!currentLine.empty()) {
		lines.push_back(currentLine);
	}

	return lines;
}

} // namespace bmsx
