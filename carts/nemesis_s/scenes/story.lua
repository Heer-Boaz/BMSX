local scene_library<const> = require('cartlib/world/scene_library')
local presentation<const> = require('presentation')
local caption<const> = require('presentation/caption')
local curtain<const> = require('presentation/curtain')
local game_text_module<const> = require('game_text')

local game_text<const>: *game_text_record = game_text_module.game_text
local story_scene<const> = {
	id = 'nemesis_s.story.presentation',
	portrait_imgid = 'story_piet2',
	panels = {
		{ imgid = 'story_coup', text = game_text[0].story_1_text, text_y = 0 },
		{ imgid = 'story_piet1', text = game_text[0].story_2_text, text_y = -16 },
		{ imgid = 'story_escape', text = game_text[0].story_3_text, text_y = 0 },
		{ imgid = 'story_boot', text = game_text[0].story_4_text, text_y = 8 },
		{ imgid = 'story_winterstad', text = game_text[0].story_5_text, text_y = 16 },
		{ text = game_text[0].story_6_text, text_y = -16 },
		{ imgid = 'story_map', text = game_text[0].story_7_text, text_y = 0 },
		{ imgid = 'story_metalion', text = game_text[0].story_8_text, text_y = 0 },
		{ imgid = 'story_pilot', text = game_text[0].story_9_text, text_y = -16 },
	},
}

function story_scene.register()
	scene_library.register(story_scene.id, {
		objects = {
			{
				member_id = 'picture',
				definition_id = presentation.sprite_definition_id,
				options = { pos = { x = 0, y = 0, z = 0 } },
			},
			{
				member_id = 'primary_caption',
				definition_id = caption.definition_id,
				options = { pos = { x = 0, y = 144, z = 1 } },
			},
			{
				member_id = 'secondary_caption',
				definition_id = caption.definition_id,
				options = {
					text = game_text[0].story_piet_text,
					pos = { x = 0, y = 136, z = 2 },
				},
			},
			{
				member_id = 'curtain',
				definition_id = curtain.definition_id,
				options = {
					sx = 256, sy = 192, opening_bottom = 128,
					pos = { x = 0, y = 0, z = 3 },
				},
			},
		},
	})
end

return story_scene
