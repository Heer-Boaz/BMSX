local font<const> = require('cartlib/font')

local font_id<const> = 'nemesis_s'
local glyphs<const> = {
	[','] = 'font_comma',
	['.'] = 'font_dot',
	['!'] = 'font_exclamation',
	['?'] = 'font_question',
	["'"] = 'font_apostrophe',
	[' '] = 'font_space',
	['-'] = 'font_hyphen',
}

for codepoint = 0x41, 0x5a do
	local glyph<const> = string.char(codepoint)
	glyphs[glyph] = 'font_' .. string.lower(glyph)
end

for codepoint = 0x30, 0x39 do
	local glyph<const> = string.char(codepoint)
	glyphs[glyph] = 'font_' .. glyph
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
