-- Registered scenes are direct, ordered cart-owned composition definitions.
-- Instantiation is a cold operation: each member delegates construction and
-- admission to World, while the returned map keeps scene-local identity apart
-- from Registry-owned runtime identity.

local world<const> = require('cartlib/world/world')

local definitions<const> = {}
local scene_library<const> = {}

function scene_library.register(id, definition)
	definitions[id] = definition
end

function scene_library.instantiate(id)
	local objects<const> = definitions[id].objects
	local members<const> = {}
	for index = 1, #objects do
		local object<const> = objects[index]
		members[object.member_id] = world:spawn(object.definition_id, object.options)
	end
	return members
end

-- The cart owns the returned group; World owns removal, including pending
-- admissions and component/event teardown at its existing structural barrier.
function scene_library.dispose(members)
	for _, object in pairs(members) do
		world:mark_for_disposal(object)
	end
end

return scene_library
