-- Registered scenes are direct, ordered cart-owned composition definitions.
-- Instantiation is a cold operation: each member delegates construction and
-- admission to World. The live scene owns both authored members and procedural
-- descendants; its member keys are distinct from Registry-owned runtime IDs.

local scene<const> = require('cartlib/world/scene')

local definitions<const> = {}
local scene_library<const> = {}

function scene_library.register(id, definition)
	definitions[id] = definition
end

function scene_library.definition(id)
	return definitions[id]
end

-- Runtime bindings (e.g. the current players' state) override only the named
-- members. Keep authored options immutable so the next instance starts fresh.
function scene_library.create(id)
	return scene.new(definitions[id])
end

function scene_library.instantiate(id, overrides)
	local instance<const> = scene_library.create(id)
	local objects<const> = instance.definition.objects
	for index = 1, #objects do
		local object<const> = objects[index]
		local member_overrides<const> = overrides and overrides[object.member_id]
		instance:spawn_member(object, member_overrides)
	end
	return instance
end

return scene_library
