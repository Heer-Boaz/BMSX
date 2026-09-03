local actor<const> = require('actor')
local scene_library<const> = require('cartlib/world/scene_library')

local root_scene<const> = {}
root_scene.id = 'scene_test.root'

function root_scene.register()
	scene_library.register(root_scene.id, {
		objects = {
			{
				member_id = 'actor',
				definition_id = actor.definition_id,
				space_id = 'main',
				pos = { x = 10, y = 20, z = 30 },
			},
		},
	})
end

function root_scene.register_pending_test_revision()
	scene_library.register(root_scene.id, {
		objects = {
			{
				member_id = 'actor',
				definition_id = actor.definition_id,
				space_id = 'main',
				pos = { x = 40, y = 50, z = 60 },
			},
		},
	})
end

return root_scene
