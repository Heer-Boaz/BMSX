local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')

local scene<const> = { id = 'p3.combat.scene' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'monster', definition_id = presentation.sprite,
				options = {
					id = 'p3.combat.monster', imgid = 'monster_snoozer', visible = false,
					pos = { x = 208, y = 60, z = 200 },
				},
			},
			{
				member_id = 'maya_a', definition_id = presentation.sprite,
				options = {
					id = 'p3.combat.maya_a', imgid = 'maya_a', visible = false,
					pos = { x = 0, y = 240, z = 300 },
				},
			},
			{
				member_id = 'maya_b', definition_id = presentation.sprite,
				options = {
					id = 'p3.combat.maya_b', imgid = 'maya_b', visible = false,
					pos = { x = 320, y = 240, z = 300 },
				},
			},
			{
				member_id = 'all_out', definition_id = presentation.surface,
				options = {
					id = 'p3.combat.all_out', imgid = 'all_out', visible = false,
					pos = { x = 0, y = 0, z = 800 },
				},
			},
			{
				member_id = 'portrait', definition_id = presentation.sprite,
				options = {
					id = 'p3.combat.all_out_portrait', imgid = 'maya_v_s', visible = false,
					pos = { x = 25, y = 240, z = 750 },
				},
			},
			{
				member_id = 'cover', definition_id = presentation.rectangle,
				options = {
					visible = false, color = 0, width = 320, height = 240,
					pos = { x = 0, y = 0, z = 850 },
				},
			},
			{
				member_id = 'results', definition_id = presentation.text,
				options = {
					id = 'p3.text.results', blank_lines = 1,
					results_offset_x = -16,
					pos = { x = 32, y = 32, z = 1003 },
					dimensions = { left = 0, right = 320 - (320 / 3) - 32, top = 0, bottom = 128 },
				},
			},
		},
	})
end

return scene
