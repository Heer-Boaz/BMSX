local string<const> = require('stdlib/string')
local romdir<const> = require('cartlib/romdir')
local byte<const> = string.byte

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
	local items<const> = {}
	for glyph, imgid in pairs(definition.glyphs) do
		local image_meta<const> = romdir.image(imgid).imgmeta
		items[byte(glyph)] = {
			imgid = imgid,
			width = image_meta.width,
			height = image_meta.height,
			advance = image_meta.width + advance_padding,
			gx_source_x = image_meta.gx_source_x,
			gx_source_y = image_meta.gx_source_y,
		}
	end
	local space<const> = items[0x20]
	if space and not items[0x09] then
		items[0x09] = {
			imgid = space.imgid,
			width = space.width,
			height = space.height,
			advance = space.advance * 4,
			gx_source_x = space.gx_source_x,
			gx_source_y = space.gx_source_y,
		}
	end
	local line_glyph<const> = items[0x41] or items[0x61] or items[0x3f]
	return {
		items = items,
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


function font.write_glyph_line(id_or_descriptor, line, target)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local items<const> = descriptor.items
	local fallback<const> = items[0x3f]
	local length<const> = #line
	local width = 0
	for index = 1, length do
		local glyph<const> = items[byte(line, index)] or fallback
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
	local fallback<const> = items[0x3f]
	for index = 1, #line do
		fn(items[byte(line, index)] or fallback)
	end
end

function font.measure_line_width(id_or_descriptor, line)
	local descriptor<const> = type(id_or_descriptor) == 'table' and id_or_descriptor or font.get(id_or_descriptor)
	local items<const> = descriptor.items
	local fallback<const> = items[0x3f]
	local width = 0
	for index = 1, #line do
		width = width + (items[byte(line, index)] or fallback).advance
	end
	return width
end

font.define('default', {
	glyphs = default_glyphs,
	line_height = 6,
})

return font
