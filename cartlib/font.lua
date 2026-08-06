local string_lib<const> = string
local image<const> = require('cartlib/gx/image')
local byte<const> = string_lib.byte

local font<const> = {}

local definitions<const> = {}
local resolved_fonts<const> = {}

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

local build_resolved_font<const> = function(definition)
	local advance_padding<const> = definition.advance_padding or 0
	local items<const> = {}
	for glyph, imgid in pairs(definition.glyphs) do
		local source<const> = image.resolve(imgid)
		items[byte(glyph)] = {
			source = source,
			width = source.width,
			height = source.height,
			advance = source.width + advance_padding,
		}
	end
	local space<const> = items[0x20]
	if space and not items[0x09] then
		items[0x09] = {
			source = space.source,
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
	resolved_fonts[id] = nil
end

function font.get(id)
	local resolved_font = resolved_fonts[id]
	if resolved_font == nil then
		local definition = definitions[id]
		if definition == nil and id == 'default' then
			definition = build_default_definition()
			definitions[id] = definition
		end
		resolved_font = build_resolved_font(definition)
		resolved_fonts[id] = resolved_font
	end
	return resolved_font
end

function font.write_glyph_line(resolved_font, line, target)
	local items<const> = resolved_font.items
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

return font
