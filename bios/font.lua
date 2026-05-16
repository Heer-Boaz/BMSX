local vdp_image<const> = require('bios/vdp_image')

local font<const> = {}

local definitions<const> = {}
local descriptors<const> = {}

local default_glyphs<const> = {
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
	default_glyphs[c] = 'msx_6b_font_' .. c
end
for codepoint = string.byte('a'), string.byte('z') do
	local lower<const> = string.char(codepoint)
	local upper<const> = string.char(codepoint - 32)
	default_glyphs[lower] = 'msx_6b_font_low_' .. lower
	default_glyphs[upper] = 'msx_6b_font_' .. lower
end

local build_descriptor<const> = function(definition)
	local advance_padding<const> = definition.advance_padding or 0
	local glyphs<const> = {}
	for glyph, imgid in pairs(definition.glyphs) do
		local rect<const> = vdp_image.rect(imgid)
		glyphs[glyph] = {
			imgid = imgid,
			width = rect.w,
			height = rect.h,
			advance = rect.w + advance_padding,
		}
	end
	local space<const> = glyphs[' ']
	if space ~= nil and glyphs['\t'] == nil then
		glyphs['\t'] = {
			imgid = space.imgid,
			width = space.advance * 4,
			height = space.height,
			advance = space.advance * 4,
		}
	end
	local line_glyph<const> = glyphs['A'] or glyphs['a'] or glyphs['?']
	return {
		items = glyphs,
		glyphs = glyphs,
		line_height = definition.line_height or line_glyph.height,
		advance_padding = advance_padding,
	}
end

function font.define(id, definition)
	definitions[id] = definition
	descriptors[id] = build_descriptor(definition)
end

function font.definition(id)
	return definitions[id]
end

function font.get(id)
	return descriptors[id]
end

function font.for_each_glyph(id_or_descriptor, line, fn)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	font_for_each_item(descriptor, line, fn)
end

function font.measure_line_width(id_or_descriptor, line)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local max_w<const> = font_measure_line_width(descriptor, line)
	return max_w
end

font.define('default', {
	glyphs = default_glyphs,
	line_height = 8,
})

return font
