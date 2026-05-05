/*
 * glyphs.cpp - Glyph rendering utilities
 */

#include "glyphs.h"
#include "render/shared/bitmap_font.h"
#include <cctype>

namespace bmsx {

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
