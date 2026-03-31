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

return font
