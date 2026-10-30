local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.dialogue.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background', definition_id = presentation.surface,
				options = { id = 'p3.bg' },
				spatial = { local_transform = { 1, 0, 0, 1, 0, 0 } },
				initial = { surface = {
					visible = false,
					order = 0,
					attachment_affine = { 1, 0, 0, 1, 0, 0 },
				} },
			},
			{
				member_id = 'main', definition_id = presentation.text,
				options = { id = 'p3.text.main' },
				spatial = { local_transform = { 1, 0, 0, 1, 0, 0 } },
				initial = { text = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 64 },
					order = 1000,
					attachment_affine = { 1, 0, 0, 1, 32, 96 },
				} },
			},
			{
				member_id = 'choice', definition_id = presentation.text,
				options = { id = 'p3.text.choice' },
				spatial = { local_transform = { 1, 0, 0, 1, 0, 0 } },
				initial = { text = {
					blank_lines = 1,
					highlight_move_enabled = true,
					highlight_pulse_enabled = true,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 64 },
					order = 1001,
					attachment_affine = { 1, 0, 0, 1, 32, 160 },
				} },
			},
			{
				member_id = 'prompt', definition_id = presentation.text,
				options = { id = 'p3.text.prompt' },
				spatial = { local_transform = { 1, 0, 0, 1, 0, 0 } },
				initial = { text = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 256, top = 0, bottom = 16 },
					order = 1002,
					attachment_affine = { 1, 0, 0, 1, 32, 224 },
				} },
			},
		},
	})
end

return scene
