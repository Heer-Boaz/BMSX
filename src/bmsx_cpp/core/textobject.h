/*
 * textobject.h - Text rendering world object
 *
 * Mirrors TypeScript core/object/textobject.ts.
 */

#ifndef BMSX_TEXTOBJECT_H
#define BMSX_TEXTOBJECT_H

#include "world.h"
#include "font.h"
#include "../render/render_types.h"
#include <optional>
#include <vector>

namespace bmsx {

class TextObject : public WorldObject {
public:
	explicit TextObject(const Identifier& id, BFont* defaultFont);

	std::vector<std::string> text{""};
	std::vector<std::string> full_text_lines{""};
	std::vector<std::string> displayed_lines{""};
	i32 current_line_index = 0;
	i32 current_char_index = 0;
	i32 maximum_characters_per_line = 0;
	std::optional<i32> highlighted_line_index;
	bool is_typing = false;
	BFont* font = nullptr;
	Color highlight_color{0.0f, 0.0f, 0.5f, 1.0f};
	Color text_color{1.0f, 1.0f, 1.0f, 1.0f};
	RectBounds dimensions;
	f32 centered_block_x = 0.0f;

	void setText(const std::string& textValue);
	void typeNext();
	void setDimensions(const RectBounds& rect);
	void updateDisplayedText();
	void recenterTextBlock();

	void submitForRendering(GameView* view) override;
};

} // namespace bmsx

#endif // BMSX_TEXTOBJECT_H
