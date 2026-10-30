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
			},
			{
				member_id = 'caption',
				definition_id = caption.definition_id,
				spatial = { local_transform = { 1, 0, 0, 1, 0, 8 } },
				initial = { text = { order = 1 } },
			},
			{
				member_id = 'curtain',
				definition_id = curtain.definition_id,
				options = {
					visible = false,
				},
				initial = { curtain = { width = 256, height = 192, mode = 1, order = 2 } },
			},
		},
	})
end

return end_demo_scene
