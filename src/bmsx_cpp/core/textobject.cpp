/*
 * textobject.cpp - Text rendering world object
 */

#include "textobject.h"
#include "engine.h"
#include "../render/gameview.h"
#include "../render/glyphs.h"

namespace bmsx {

TextObject::TextObject(const Identifier& id, BFont* defaultFont)
	: WorldObject(id)
	, font(defaultFont)
{
	auto* view = EngineCore::instance().view();
	dimensions.left = 0.0f;
	dimensions.top = 0.0f;
	dimensions.right = view->viewportSize.x;
	dimensions.bottom = view->viewportSize.y;
	maximum_characters_per_line = static_cast<i32>((dimensions.right - dimensions.left) / font->char_width(' '));
	recenterTextBlock();
}

void TextObject::setText(const std::string& textValue) {
	full_text_lines = wrapGlyphs(textValue, maximum_characters_per_line);
	displayed_lines.clear();
	displayed_lines.resize(full_text_lines.size());
	current_line_index = 0;
	current_char_index = 0;
	is_typing = true;
	recenterTextBlock();
	updateDisplayedText();
}

void TextObject::typeNext() {
	if (!is_typing) {
		return;
	}

	if (current_line_index >= static_cast<i32>(full_text_lines.size())) {
		is_typing = false;
		return;
	}

	const std::string& line = full_text_lines[static_cast<size_t>(current_line_index)];
	if (current_char_index < static_cast<i32>(line.size())) {
		displayed_lines[static_cast<size_t>(current_line_index)].push_back(line[static_cast<size_t>(current_char_index)]);
		++current_char_index;
		updateDisplayedText();
		return;
	}

	++current_line_index;
	current_char_index = 0;
	if (current_line_index >= static_cast<i32>(full_text_lines.size())) {
		is_typing = false;
	}
	updateDisplayedText();
}

void TextObject::setDimensions(const RectBounds& rect) {
	dimensions = rect;
	maximum_characters_per_line = static_cast<i32>((dimensions.right - dimensions.left) / font->char_width(' '));
	recenterTextBlock();
}

void TextObject::updateDisplayedText() {
	text = displayed_lines;
}

void TextObject::recenterTextBlock() {
	f32 longestWidth = 0.0f;
	for (const auto& line : full_text_lines) {
		f32 width = static_cast<f32>(font->measure(line));
		if (width > longestWidth) {
			longestWidth = width;
		}
	}
	centered_block_x = ((dimensions.right - dimensions.left) - longestWidth) / 2.0f + dimensions.left;
}

void TextObject::submitForRendering(GameView* view) {
	if (text.empty()) return;

	const f32 lineHeight = static_cast<f32>(font->char_height(' ')) * 2.0f;
	const f32 margin = static_cast<f32>(font->char_width(' ')) / 2.0f;

	Color normalBg{0.0f, 0.0f, 0.0f, text_color.a};
	Color highlightBg{
		highlight_color.r,
		highlight_color.g,
		highlight_color.b,
		highlight_color.a * text_color.a
	};

	for (size_t i = 0; i < text.size(); ++i) {
		f32 lineY = dimensions.top + lineHeight * static_cast<f32>(i);
		bool highlighted = highlighted_line_index.has_value() && static_cast<size_t>(*highlighted_line_index) == i;

		if (highlighted) {
			RectRenderSubmission rect;
			rect.kind = RectRenderSubmission::Kind::Fill;
			rect.color = highlightBg;
			rect.area.left = dimensions.left - margin;
			rect.area.right = dimensions.right + margin;
			rect.area.top = lineY - margin;
			rect.area.bottom = dimensions.top + lineHeight * (static_cast<f32>(i) + 0.5f) + margin;
			view->renderer.submit.rect(rect);
		}

		GlyphRenderSubmission glyphs;
		glyphs.text = text[i];
		glyphs.x = centered_block_x;
		glyphs.y = lineY;
		glyphs.z = z();
		glyphs.font = font;
		glyphs.color = text_color;
		glyphs.background_color = highlighted ? highlightBg : normalBg;
		view->renderer.submit.glyphs(glyphs);
	}
}

} // namespace bmsx
