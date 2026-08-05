local string_lib<const> = string
local image<const> = require('cartlib/gx/image')
local byte<const> = string_lib.byte

local font<const> = {}

local definitions<const> = {}
local descriptors<const> = {}

local build_default_definition<const> = function()
	local glyphs<const> = {}
	for codepoint = 0x20, 0x7e do
		glyphs[string_lib.char(codepoint)] = string_lib.format('tiny_3b_font_code_0x%02x', codepoint)
	end
	return {
		glyphs = glyphs,
		line_height = 6,
	}
end

local build_descriptor<const> = function(definition)
	local advance_padding<const> = definition.advance_padding or 0
	local items<const> = {}
	for glyph, imgid in pairs(definition.glyphs) do
		local source<const> = image.resolve(imgid)
		items[byte(glyph)] = {
			image = source,
			width = source.w,
			height = source.h,
			advance = source.w + advance_padding,
		}
	end
	local space<const> = items[0x20]
	if space and not items[0x09] then
		items[0x09] = {
			image = space.image,
			width = space.width,
			height = space.height,
			advance = space.advance * 4,
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
	descriptors[id] = nil
end

function font.definition(id)
	local definition = definitions[id]
	if not definition and id == 'default' then
		definition = build_default_definition()
		definitions[id] = definition
	end
	return definition
end

function font.get(id)
	local descriptor = descriptors[id]
	if not descriptor then
		descriptor = build_descriptor(font.definition(id))
		descriptors[id] = descriptor
	end
	return descriptor
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

return font
