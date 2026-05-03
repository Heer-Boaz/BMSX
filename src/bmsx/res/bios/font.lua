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

function font.for_each_glyph(id_or_handle, line, fn)
	font_for_each_glyph(type(id_or_handle) == 'table' and id_or_handle or font.get(id_or_handle), line, fn)
end

function font.measure_line_width(id_or_handle, line)
	return font_measure_line_width(type(id_or_handle) == 'table' and id_or_handle or font.get(id_or_handle), line)
end

return font
