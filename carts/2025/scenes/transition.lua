local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.transition.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'overlay', definition_id = presentation.overlay,
				options = {
					visible = false, color = 0, blend_color = 0, blend_mode = 0,
					width = 320, height = 240, pos = { x = 0, y = 0, z = 851 },
				},
			},
			{
				member_id = 'upper', definition_id = presentation.rectangle,
				options = {
					visible = false, color = 0, palette_key = 'panel_primary',
					width = 320 * 1.15, height = 240 * 0.22,
					pos = { x = -24, y = 28.8, z = 852 },
					enter_x = -320 * 1.2, exit_x = 320, delay = 0,
				},
			},
			{
				member_id = 'middle', definition_id = presentation.rectangle,
				options = {
					visible = false, color = 0, palette_key = 'panel_secondary',
					width = 320 * 1.3, height = 240 * 0.2,
					pos = { x = -48, y = 100.8, z = 853 },
					enter_x = 320, exit_x = -320 * 1.3, delay = transition_panel_gap_frames,
				},
			},
			{
				member_id = 'lower', definition_id = presentation.rectangle,
				options = {
					visible = false, color = 0, palette_key = 'panel_primary',
					width = 320 * 0.55, height = 240 * 0.14,
					pos = { x = 72, y = 163.2, z = 854 },
					enter_x = -320 * 0.55, exit_x = 320 * 1.1, delay = overgang_fade_out_frames - 1 - transition_panel_in_frames,
				},
			},
			{
				member_id = 'accent', definition_id = presentation.rectangle,
				options = {
					visible = false, color = 0, width = 320 * 0.7, height = 16 * 1.1,
					pos = { x = 48, y = 87.2, z = 855 },
					enter_x = 320, exit_x = -320 * 0.3,
				},
			},
			{
				member_id = 'caption', definition_id = presentation.text,
				options = {
					id = 'p3.text.transition', blank_lines = 1,
					text_color = 0xff00183e, normal_bg_color = 0xffffffff,
					pos = { x = 0, y = 88, z = 900 },
					dimensions = { left = 0, right = 320, top = 0, bottom = 64 },
				},
			},
		},
	})
end

return scene
