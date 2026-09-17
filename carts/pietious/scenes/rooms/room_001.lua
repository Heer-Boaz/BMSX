-- Placement is authored in world pixels; progression decides admission.
local scene_library<const> = require('cartlib/world/scene_library')
local room_scene<const> = { id = 'pietious.room_001' }

function room_scene.register()
	scene_library.register(room_scene.id, {
		objects = {

		},
	})
end

return room_scene
