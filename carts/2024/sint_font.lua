local font<const> = require('cartlib/font')

local font_id<const> = 'sint2024'
local glyphs<const> = {
	[' '] = 'letter_space',
	[','] = 'letter_comma',
	['.'] = 'letter_dot',
	['!'] = 'letter_exclamation',
	['?'] = 'letter_question',
	['\''] = 'letter_apostroph',
	[':'] = 'letter_colon',
	['-'] = 'letter_streep',
	['–'] = 'letter_streep',
	['/'] = 'letter_slash',
	['%'] = 'letter_percent',
	['['] = 'letter_speakstart',
	[']'] = 'letter_speakend',
	['('] = 'letter_haakjeopen',
	[')'] = 'letter_haakjesluit',
	['+'] = 'letter_question',
	['ĳ'] = 'letter_ij',
	['Ĳ'] = 'letter_ij',
}

for codepoint = string.byte('0'), string.byte('9') do
	local character<const> = string.char(codepoint)
	glyphs[character] = 'letter_' .. character
end

for codepoint = string.byte('A'), string.byte('Z') do
	local upper<const> = string.char(codepoint)
	local lower<const> = string.char(codepoint + 32)
	local glyph_id<const> = 'letter_' .. lower
	glyphs[upper] = glyph_id
	glyphs[lower] = glyph_id
end

local register<const> = function()
	font.define(font_id, {
		glyphs = glyphs,
		line_height = 8,
	})
end

return {
	font_id = font_id,
	register = register,
}
