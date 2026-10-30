local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.transition.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'overlay', definition_id = presentation.overlay,
				initial = { overlay = {
					visible = false,
					color = 0,
					blend_color = 0,
					blend_mode = 0,
					width = 320,
					height = 240,
					order = 851,
				} },
			},
			{
				member_id = 'upper', definition_id = presentation.rectangle,
				options = { palette_key = 'panel_primary', enter_x = -320 * 1.2, exit_x = 320, delay = 0 },
				initial = { rectangle = {
					visible = false,
					color = 0,
					width = 320 * 1.15,
					height = 240 * 0.22,
					order = 852,
					attachment_affine = { 1, 0, 0, 1, -24, 28.8 },
				} },
			},
			{
				member_id = 'middle', definition_id = presentation.rectangle,
				options = { palette_key = 'panel_secondary', enter_x = 320, exit_x = -320 * 1.3, delay = transition_panel_gap_frames },
				initial = { rectangle = {
					visible = false,
					color = 0,
					width = 320 * 1.3,
					height = 240 * 0.2,
					order = 853,
					attachment_affine = { 1, 0, 0, 1, -48, 100.8 },
				} },
			},
			{
				member_id = 'lower', definition_id = presentation.rectangle,
				options = { palette_key = 'panel_primary', enter_x = -320 * 0.55, exit_x = 320 * 1.1, delay = overgang_fade_out_frames - 1 - transition_panel_in_frames },
				initial = { rectangle = {
					visible = false,
					color = 0,
					width = 320 * 0.55,
					height = 240 * 0.14,
					order = 854,
					attachment_affine = { 1, 0, 0, 1, 72, 163.2 },
				} },
			},
			{
				member_id = 'accent', definition_id = presentation.rectangle,
				options = { enter_x = 320, exit_x = -320 * 0.3 },
				initial = { rectangle = {
					visible = false,
					color = 0,
					width = 320 * 0.7,
					height = 16 * 1.1,
					order = 855,
					attachment_affine = { 1, 0, 0, 1, 48, 87.2 },
				} },
			},
			{
				member_id = 'caption', definition_id = presentation.text,
				options = { id = 'p3.text.transition' },
				initial = { text = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 320, top = 0, bottom = 64 },
					color = 0xff00183e,
					background_color = 0xffffffff,
					order = 900,
					attachment_affine = { 1, 0, 0, 1, 0, 88 },
				} },
			},
		},
	})
end

return scene
