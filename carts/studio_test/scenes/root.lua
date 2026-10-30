local scenes<const> = require('cartlib/world/scene_library')
local root<const> = { id = 'studio_test.root' }

function root.register()
	scenes.register('studio_test.root', { objects = {
		{ member_id = 'first', definition_id = 'studio_test.actor',
			options = { id = 'studio_test.first', color = 0xff26a3bb },
			spatial = { local_transform = { 1, 0, 0, 1, 16, 24 } } },
		{ member_id = 'second', definition_id = 'studio_test.actor',
			options = { id = 'studio_test.second', color = 0xffbd7841 },
			spatial = { local_transform = { 1, 0, 0, 1, 112, 64 } } },
		{ member_id = 'third', definition_id = 'studio_test.actor',
			options = { id = 'studio_test.third', color = 0xff4d894f },
			spatial = { local_transform = { 1, 0, 0, 1, 32, 128 } } },
	} })
end

return root
