local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.dialogue.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background', definition_id = presentation.surface,
				options = {
					id = 'p3.bg', visible = false,
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = 'main', definition_id = presentation.text,
				options = {
					id = 'p3.text.main', blank_lines = 1,
					pos = { x = 32, y = 96, z = 1000 },
					dimensions = { left = 0, right = 256, top = 0, bottom = 64 },
				},
			},
			{
				member_id = 'choice', definition_id = presentation.text,
				options = {
					id = 'p3.text.choice', blank_lines = 1,
					pos = { x = 32, y = 160, z = 1001 },
					dimensions = { left = 0, right = 256, top = 0, bottom = 64 },
					highlight_move_enabled = true, highlight_pulse_enabled = true,
				},
			},
			{
				member_id = 'prompt', definition_id = presentation.text,
				options = {
					id = 'p3.text.prompt', blank_lines = 1,
					pos = { x = 32, y = 224, z = 1002 },
					dimensions = { left = 0, right = 256, top = 0, bottom = 16 },
				},
			},
		},
	})
end

return scene
