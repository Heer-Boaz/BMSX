__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	local font<const> = require('system/font')
	local descriptor<const> = font.get('default')
	local seen<const> = {}
	font.for_each_glyph(descriptor, 'A?€', function(item)
		seen[#seen + 1] = item.imgid
	end)
	assert(seen[1] == 'tiny_3b_font_code_0x41', 'font.for_each_glyph first glyph mismatch')
	assert(seen[2] == 'tiny_3b_font_code_0x3f', 'font.for_each_glyph second glyph mismatch')
	assert(seen[3] == 'tiny_3b_font_code_0x3f', 'font.for_each_glyph fallback glyph mismatch')
	local expected_width<const> = descriptor.glyphs['A'].advance + descriptor.glyphs['?'].advance * 2
	assert(font.measure_line_width(descriptor, 'A?€') == expected_width, 'font.measure_line_width mismatch')
end

function __bmsx_host_test.update(_frame)
	return true
end
