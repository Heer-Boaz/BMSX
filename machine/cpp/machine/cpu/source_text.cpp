#include "machine/cpu/source_text.h"

namespace bmsx {

std::optional<std::string> extractSourceRangeText(const SourceRange& range, const std::string& source) {
	if (range.start.line <= 0 || range.end.line < range.start.line) {
		return std::nullopt;
	}
	std::string out;
	int line = 1;
	size_t lineStart = 0;
	for (size_t index = 0; index <= source.size(); ++index) {
		if (index < source.size() && source[index] != '\n') {
			continue;
		}
		size_t lineEnd = index;
		if (lineEnd > lineStart && source[lineEnd - 1] == '\r') {
			lineEnd -= 1;
		}
		if (line >= range.start.line && line <= range.end.line) {
			if (!out.empty()) {
				out.push_back(' ');
			}
			out.append(source.data() + lineStart, lineEnd - lineStart);
			if (line == range.end.line) {
				return out;
			}
		}
		line += 1;
		lineStart = index + 1;
	}
	return std::nullopt;
}

} // namespace bmsx
