local scenes<const> = require('cartlib/world/scene_library')
local boolean_scene<const> = {}

function boolean_scene.register()
	scenes.register('studio_test.boolean', { objects = {
		{ member_id = 'first', definition_id = 'studio_test.actor', position = { x = 32, y = 48 },
			options = { visible = true, score = 7 } },
		{ member_id = 'second', definition_id = 'studio_test.actor', position = { x = 128, y = 96 },
			options = { visible = false, score = 7 } },
	} })
end

return boolean_scene
