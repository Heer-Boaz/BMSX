local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')
local caption<const> = require('presentation/caption')
local curtain<const> = require('presentation/curtain')
local game_text_module<const> = require('game_text')

local game_text<const>: *game_text_record = game_text_module.game_text
local end_demo_scene<const> = {
	id = 'nemesis_s.end_demo.presentation',
	panels = {
		{ imgid = 'end_demo_sint_duim', text = game_text[0].end_demo_sint_text, text_x = 0 },
		{ imgid = 'end_demo_boaz', text = game_text[0].end_demo_boaz_text, text_x = 128 },
	},
}

function end_demo_scene.register()
	scene_library.register(end_demo_scene.id, {
		objects = {
			{
				member_id = 'picture',
				definition_id = presentation.sprite_definition_id,
				options = { pos = { x = 0, y = 0, z = 0 } },
			},
			{
				member_id = 'caption',
				definition_id = caption.definition_id,
				options = { pos = { x = 0, y = 8, z = 1 } },
			},
			{
				member_id = 'curtain',
				definition_id = curtain.definition_id,
				options = {
					sx = 256, sy = 192, mode = 1, visible = false,
					pos = { x = 0, y = 0, z = 2 },
				},
			},
		},
	})
end

return end_demo_scene
