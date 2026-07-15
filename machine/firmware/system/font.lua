local romdir<const> = require('system/romdir')

local font<const> = {}

local definitions<const> = {}
local descriptors<const> = {}

local default_glyphs<const> = {
}

for codepoint = 0x20, 0x7e do
	local c<const> = string.char(codepoint)
	default_glyphs[c] = string.format('tiny_3b_font_code_0x%02x', codepoint)
end

local build_descriptor<const> = function(definition)
	local advance_padding<const> = definition.advance_padding or 0
	local glyphs<const> = {}
	for glyph, imgid in pairs(definition.glyphs) do
		local image_meta<const> = romdir.image(imgid).imgmeta
		glyphs[glyph] = {
			imgid = imgid,
			width = image_meta.width,
			height = image_meta.height,
			advance = image_meta.width + advance_padding,
			gx_source_x = image_meta.gx_source_x,
			gx_source_y = image_meta.gx_source_y,
		}
	end
	local space<const> = glyphs[' ']
	if space and not glyphs['\t'] then
		glyphs['\t'] = {
			imgid = space.imgid,
			width = space.width,
			height = space.height,
			advance = space.advance * 4,
			gx_source_x = space.gx_source_x,
			gx_source_y = space.gx_source_y,
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


local glyph_item<const> = function(items, glyph)
	local item<const> = items[glyph]
	if item then
		return item
	end
	return items['?']
end

function font.write_glyph_line(id_or_descriptor, line, target)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local items<const> = descriptor.items
	local length<const> = #line
	local width = 0
	for index = 1, length do
		local glyph<const> = glyph_item(items, string.sub(line, index, index))
		target[index] = glyph
		width = width + glyph.advance
	end
	for index = length + 1, #target do
		target[index] = nil
	end
	return width
end

function font.for_each_glyph(id_or_descriptor, line, fn)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local items<const> = descriptor.items
	for index = 1, #line do
		fn(glyph_item(items, string.sub(line, index, index)))
	end
end

function font.measure_line_width(id_or_descriptor, line)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local items<const> = descriptor.items
	local width = 0
	for index = 1, #line do
		width = width + glyph_item(items, string.sub(line, index, index)).advance
	end
	return width
end

font.define('default', {
	glyphs = default_glyphs,
	line_height = 6,
})

return font
