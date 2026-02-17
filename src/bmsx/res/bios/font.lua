local font = {}

local definitions = {}
local handles = {}

function font.define(id, definition)
	definitions[id] = definition
	handles[id] = nil
end

function font.definition(id)
	return definitions[id]
end

function font.get(id)
	local handle = handles[id]
	if handle == nil then
		handle = create_font(definitions[id])
		handles[id] = handle
	end
	return handle
end

return font
