-- Registration admits an ordered composition over concrete prefab definitions.
-- Instantiation shares that plan; the live Scene owns authored and procedural
-- objects while World owns construction and publication.

local scene<const> = require('cartlib/world/scene')
local scene_plan<const> = require('cartlib/world/scene_plan')

local definitions<const> = {}
local scene_library<const> = {}

function scene_library.register(id, definition)
	definitions[id] = scene_plan.compile(definition)
end

function scene_library.definition(id)
	return definitions[id]
end

-- Staged construction selects the admitted member by scene-local identity.
function scene_library.member_definition(id, member_id)
	return definitions[id].members_by_id[member_id]
end

-- Runtime bindings (e.g. the current players' state) override only the named
-- members. Keep authored options immutable so the next instance starts fresh.
function scene_library.create(id)
	return scene.new(definitions[id])
end

function scene_library.instantiate(id, overrides)
	local instance<const> = scene_library.create(id)
	instance:spawn_all(overrides)
	return instance
end

return scene_library
