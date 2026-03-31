local font<const> = require('font')

local glyphs<const> = {
	[' '] = 'pf_sp',
	[','] = 'pf_comma',
	['.'] = 'pf_dot',
	['!'] = 'pf_excl',
	['?'] = 'pf_qm',
	['\''] = 'pf_apo',
	[':'] = 'pf_colon',
	['-'] = 'pf_streep',
	['–'] = 'pf_streep',
	['—'] = 'pf_streep',
	['_'] = 'pf_line',
	['█'] = 'pf_line',
	['/'] = 'pf_slash',
	['%'] = 'pf_percent',
	['['] = 'pf_speakstart',
	[']'] = 'pf_speakend',
	['+'] = 'pf_qm',
	['¡'] = 'pf_ij',
}
for codepoint = string.byte('0'), string.byte('9') do
	local c<const> = string.char(codepoint)
	glyphs[c] = 'pf_' .. c
end
for codepoint = string.byte('A'), string.byte('Z') do
	local upper<const> = string.char(codepoint)
	local lower<const> = string.char(codepoint + 32)
	local glyph_id<const> = 'pf_' .. lower
	glyphs[upper] = glyph_id
	glyphs[lower] = glyph_id
end

local register_fonts<const> = function()
	font.define('pietious', {
		glyphs = glyphs,
	})
end

return {
	register_fonts = register_fonts,
}
