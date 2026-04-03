local font<const> = {}

local definitions<const> = {}
local handles<const> = {}

function font.define(id, definition)
	definitions[id] = definition
	handles[id] = nil
end

function font.definition(id)
	return definitions[id]
end

function font.get(id)
	local handle = handles[id]
	if handle ~= nil then
		return handle
	end
	handle = create_font(definitions[id])
	handles[id] = handle
	return handle
end

function font.measure_line_width(id_or_handle, line)
	local font_handle<const> = type(id_or_handle) == 'table' and id_or_handle or font.get(id_or_handle)
	local width = 0
	local line_length<const> = string.len(line)
	for i = 1, line_length do
		local glyph<const> = font_handle.glyphs[line:sub(i, i)] or font_handle.glyphs['?']
		width = width + glyph.advance
	end
	return width
end

return font
