local font<const> = require('system/font')

local glyphs<const> = {
	[' '] = 'msx_6b_font_space',
	['!'] = 'msx_6b_font_exclamation',
	['"'] = 'msx_6b_font_code_0x22',
	['#'] = 'msx_6b_font_code_0x23',
	['$'] = 'msx_6b_font_code_0x24',
	['%'] = 'msx_6b_font_percent',
	['&'] = 'msx_6b_font_code_0x26',
	['\''] = 'msx_6b_font_apostroph',
	['('] = 'msx_6b_font_code_0x28',
	[')'] = 'msx_6b_font_code_0x29',
	['*'] = 'msx_6b_font_code_0x2a',
	['+'] = 'msx_6b_font_code_0x2b',
	[','] = 'msx_6b_font_comma',
	['-'] = 'msx_6b_font_streep',
	['–'] = 'msx_6b_font_streep',
	['.'] = 'msx_6b_font_dot',
	['/'] = 'msx_6b_font_slash',
	[':'] = 'msx_6b_font_colon',
	[';'] = 'msx_6b_font_code_0x3b',
	['<'] = 'msx_6b_font_code_0x3c',
	['='] = 'msx_6b_font_code_0x3d',
	['>'] = 'msx_6b_font_code_0x3e',
	['?'] = 'msx_6b_font_question',
	['@'] = 'msx_6b_font_at_sign',
	['['] = 'msx_6b_font_code_0x5b',
	['\\'] = 'msx_6b_font_code_0x5c',
	[']'] = 'msx_6b_font_code_0x5d',
	['^'] = 'msx_6b_font_code_0x5e',
	['_'] = 'msx_6b_font_line',
	['`'] = 'msx_6b_font_code_0x60',
	['{'] = 'msx_6b_font_code_0x7b',
	['|'] = 'msx_6b_font_code_0x7c',
	['}'] = 'msx_6b_font_code_0x7d',
	['~'] = 'msx_6b_font_code_0x7e',
	['•'] = 'msx_6b_font_ctrl_bel',
	['¡'] = 'msx_6b_font_code_0x80',
	['█'] = 'msx_6b_font_code_0xc8',
	['—'] = 'msx_6b_font_ctrl_etb',
}

for codepoint = string.byte('0'), string.byte('9') do
	local c<const> = string.char(codepoint)
	glyphs[c] = 'msx_6b_font_' .. c
end
for codepoint = string.byte('a'), string.byte('z') do
	local lower<const> = string.char(codepoint)
	local upper<const> = string.char(codepoint - 32)
	glyphs[lower] = 'msx_6b_font_low_' .. lower
	glyphs[upper] = 'msx_6b_font_' .. lower
end

local register_fonts<const> = function()
	font.define('default', {
		glyphs = glyphs,
		line_height = 8,
	})
end

return {
	register_fonts = register_fonts,
}
