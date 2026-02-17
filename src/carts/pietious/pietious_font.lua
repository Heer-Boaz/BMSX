local font = require('font')

local function build_glyphs()
	local glyphs = {
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
		local c = string.char(codepoint)
		glyphs[c] = 'pf_' .. c
	end
	for codepoint = string.byte('A'), string.byte('Z') do
		local upper = string.char(codepoint)
		local lower = string.char(codepoint + 32)
		local glyph_id = 'pf_' .. lower
		glyphs[upper] = glyph_id
		glyphs[lower] = glyph_id
	end
	return glyphs
end

local function register_fonts()
	font.define('pietious', {
		glyphs = build_glyphs(),
	})
end

return {
	register_fonts = register_fonts,
}
