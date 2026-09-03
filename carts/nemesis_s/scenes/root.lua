local scene_library<const> = require('cartlib/world/scene_library')
local director<const> = require('director')
local intro<const> = require('intro')
local story<const> = require('story')
local title_screen<const> = require('title_screen')

local root_scene<const> = {
	id = 'nemesis_s.root',
}

function root_scene.register()
	scene_library.register(root_scene.id, {
		objects = {
			{
				member_id = intro.instance_id,
				definition_id = intro.definition_id,
				options = {
					space_id = 'intro',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = story.instance_id,
				definition_id = story.definition_id,
				options = {
					space_id = 'story',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = title_screen.instance_id,
				definition_id = title_screen.definition_id,
				options = {
					space_id = 'title',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
			{
				member_id = director.director_instance_id,
				definition_id = director.director_def_id,
				options = {
					space_id = 'intro',
					pos = { x = 0, y = 0, z = 0 },
				},
			},
		},
	})
end

return root_scene
