local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.dialogue.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background', definition_id = presentation.surface,
				options = {
					visible = false,
					id = 'p3.bg',
				},
			},
			{
				member_id = 'main', definition_id = presentation.text,
				options = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 64 },
					order = 1000,
					attachment_affine = { 1, 0, 0, 1, 32, 96 },
					id = 'p3.text.main',
				},
			},
			{
				member_id = 'choice', definition_id = presentation.text,
				options = {
					blank_lines = 1,
					highlight_move_enabled = true,
					highlight_pulse_enabled = true,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 64 },
					order = 1001,
					attachment_affine = { 1, 0, 0, 1, 32, 160 },
					id = 'p3.text.choice',
				},
			},
			{
				member_id = 'prompt', definition_id = presentation.text,
				options = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 16 },
					order = 1002,
					attachment_affine = { 1, 0, 0, 1, 32, 224 },
					id = 'p3.text.prompt',
				},
			},
		},
	})
end

return scene
