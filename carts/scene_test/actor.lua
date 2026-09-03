local prefab<const> = require('cartlib/world/prefab')
local world_object<const> = require('cartlib/world/world_object')

local actor<const> = {}
actor.__index = actor

local actor_module<const> = {
	definition_id = 'scene_test.actor',
}

function actor_module.register()
	prefab.define({
		def_id = actor_module.definition_id,
		class = actor,
		base = world_object,
	})
end

return actor_module
