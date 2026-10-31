local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.combat.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'monster', definition_id = presentation.sprite,
				options = {
					imgid = 'monster_snoozer',
					visible = false,
					order = 200,
					attachment_affine = { 1, 0, 0, 1, 208, 60 },
					id = 'p3.combat.monster',
				},
			},
			{
				member_id = 'maya_a', definition_id = presentation.sprite,
				options = {
					imgid = 'maya_a',
					visible = false,
					order = 300,
					attachment_affine = { 1, 0, 0, 1, 0, 240 },
					id = 'p3.combat.maya_a',
				},
			},
			{
				member_id = 'maya_b', definition_id = presentation.sprite,
				options = {
					imgid = 'maya_b',
					visible = false,
					order = 300,
					attachment_affine = { 1, 0, 0, 1, 320, 240 },
					id = 'p3.combat.maya_b',
				},
			},
			{
				member_id = 'all_out', definition_id = presentation.surface,
				options = {
					imgid = 'all_out',
					visible = false,
					order = 800,
					id = 'p3.combat.all_out',
				},
			},
			{
				member_id = 'portrait', definition_id = presentation.sprite,
				options = {
					imgid = 'maya_v_s',
					visible = false,
					order = 750,
					attachment_affine = { 1, 0, 0, 1, 25, 240 },
					id = 'p3.combat.all_out_portrait',
				},
			},
			{
				member_id = 'cover', definition_id = presentation.rectangle,
				options = {
					visible = false,
					color = 0,
					width = 320,
					height = 240,
					order = 850,
				},
			},
			{
				member_id = 'results', definition_id = presentation.text,
				options = {
					blank_lines = 1,
					layout_rect = { left = 0, right = 320 - (320 / 3) - 32, top = 0, bottom = 128 },
					order = 1003,
					attachment_affine = { 1, 0, 0, 1, 32, 32 },
					id = 'p3.text.results',
					results_offset_x = -16,
				},
			},
		},
	})
end

return scene
