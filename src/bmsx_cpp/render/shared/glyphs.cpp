/*
 * glyphs.cpp - Glyph rendering utilities
 */

#include "glyphs.h"
#include "../gameview.h"
#include "core/font.h"
#include "core/utf8.h"
#include "machine/bus/io.h"
#include <cctype>
#include <stdexcept>

namespace bmsx {
namespace {

void renderGlyphSpan(GameView* view, const std::string& text, i32 start, i32 end, f32& x, f32& y,
						f32 startX, f32& stepY, f32 z, BFont* font, const Color& color,
	const std::optional<Color>& backgroundColor, RenderLayer layer) {
	ImgRenderSubmission spriteOptions;
	spriteOptions.pos = {x, y, z};
	spriteOptions.colorize = color;
	spriteOptions.layer = layer;
	spriteOptions.scale = {1.0f, 1.0f};
	spriteOptions.flip = FlipOptions{};

	RectRenderSubmission rectOptions;
	rectOptions.kind = RectRenderSubmission::Kind::Fill;
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
			rectOptions.color = *backgroundColor;
			RectBounds& area = rectOptions.area;
			area.left = x;
			area.top = y;
			area.right = x + stepX;
			area.bottom = y + stepY;
			area.z = z;
			view->renderer.submit.rect(rectOptions);
		}

		spriteOptions.pos.x = x;
		spriteOptions.pos.y = y;
		if (glyph.rect.atlasId != static_cast<i32>(VDP_SYSTEM_ATLAS_ID)) {
			throw BMSX_RUNTIME_ERROR("Glyph atlas is not loaded in the system VDP slot.");
		}
		spriteOptions.slot = VDP_SLOT_SYSTEM;
		spriteOptions.u = glyph.rect.u;
		spriteOptions.v = glyph.rect.v;
		spriteOptions.w = glyph.rect.w;
		spriteOptions.h = glyph.rect.h;
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
					i32 start,
					i32 end,
					f32 z,
					BFont* font,
					const Color& color,
					const std::optional<Color>& backgroundColor,
					RenderLayer layer) {
	if (!font) {
		throw BMSX_RUNTIME_ERROR("No font or default font available for renderGlyphs");
	}
	f32 stepY = 0.0f;
	for (const auto& line : lines) {
		if (line.empty()) {
			y += static_cast<f32>(font->lineHeight());
			if (y >= view->canvasSize.y) {
				return;
			}
			continue;
		}
		renderGlyphSpan(view, line, start, end, x, y, x, stepY,
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
