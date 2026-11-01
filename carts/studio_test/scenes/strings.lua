local scenes<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local text<const> = require('cartlib/text/text_component')
local sprite<const> = require('cartlib/component/sprite_component')
local root_scene<const> = require('scenes/root')
local string_scene<const> = {}

function string_scene.register()
	prefab.define({ def_id = 'studio_test.literal_string', class = object_2d,
		scale = { x = 2, y = 2 },
		components = { text.factory({ text = 'LIT' .. 'ERAL', color = 0xffffffff }) } })
	prefab.define({ def_id = 'studio_test.imported_string', class = object_2d,
		scale = { x = 2, y = 2 },
		components = { text.factory({ text = root_scene.id .. ' TEXT', color = 0xff26a3bb }) } })
	prefab.define({ def_id = 'studio_test.string_sprite', class = object_2d,
		scale = { x = 4, y = 4 },
		components = { sprite.factory({ imgid = 'studio_test_' .. 'marker' }) } })

	scenes.register('studio_test.strings', { objects = {
		{ member_id = 'literal', definition_id = 'studio_test.literal_string', position = { x = 24, y = 32 } },
		{ member_id = 'imported', definition_id = 'studio_test.imported_string', position = { x = 24, y = 64 } },
		{ member_id = 'sprite', definition_id = 'studio_test.string_sprite', position = { x = 24, y = 104 } },
	} })
end

return string_scene
