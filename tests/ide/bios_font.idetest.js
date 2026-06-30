// Headless IDE test: font glyph iteration and measurement are owned by BIOS Lua.

const result = t.evaluateLua(`
local font<const> = require('system/font')
local descriptor<const> = font.get('default')
local seen<const> = {}
font.for_each_glyph(descriptor, 'A?€', function(item)
	seen[#seen + 1] = item.imgid
end)
local expected_width<const> = descriptor.glyphs['A'].advance + descriptor.glyphs['?'].advance + descriptor.glyphs['?'].advance
return seen[1], seen[2], seen[3], font.measure_line_width(descriptor, 'A?€'), expected_width
`);
t.assert(result[0] === 'msx_6b_font_a', `font.for_each_glyph first glyph mismatch: ${result[0]}`);
t.assert(result[1] === 'msx_6b_font_question', `font.for_each_glyph second glyph mismatch: ${result[1]}`);
t.assert(result[2] === 'msx_6b_font_question', `font.for_each_glyph fallback glyph mismatch: ${result[2]}`);
t.assert(result[3] === result[4], `font.measure_line_width mismatch: ${result[3]} !== ${result[4]}`);
