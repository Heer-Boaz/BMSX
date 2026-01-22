-- ide_constants.lua

local constants = {}

constants.tab_spaces = 2
constants.scrollbar_width = 3
constants.scrollbar_min_thumb_height = 6
constants.code_area_right_margin = 6

-- Light theme palette indices from the TS editor constants.
constants.color_top_bar = 19
constants.color_status_bar = 19
constants.color_gutter_background = 19
constants.color_code_background = 18
constants.color_scrollbar_track = 19
constants.color_scrollbar_thumb = 35
constants.color_text_dim = 44

constants.color_syntax = {
	code_text = 22,
	code_dim = 44,
	comment = 44,
	string = 39,
	number = 40,
	keyword = 38,
	operator = 22,
	function_name = 43,
	builtin = 41,
	parameter = 22,
	label = 42,
}

return constants
