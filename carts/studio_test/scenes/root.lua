local scenes<const> = require('cartlib/world/scene_library')
local root<const> = { id = 'studio_test.root' }

function root.register()
	scenes.register('studio_test.root', { objects = {
		{ member_id = 'first', definition_id = 'studio_test.actor',
			options = {
				id = 'studio_test.first',
				color = 0xff26a3bb,
			},
			position = { x = 16, y = 24 } },
		{ member_id = 'second', definition_id = 'studio_test.actor',
			options = {
				id = 'studio_test.second',
				color = 0xffbd7841,
			},
			position = { x = 112, y = 64 } },
		{ member_id = 'third', definition_id = 'studio_test.actor',
			options = {
				id = 'studio_test.third',
				color = 0xff4d894f,
			},
			position = { x = 32, y = 128 } },
	} })
end

return root
