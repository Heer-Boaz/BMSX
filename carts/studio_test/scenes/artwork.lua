local scenes<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local rectangle<const> = require('cartlib/component/rectangle_component')
local sprite<const> = require('cartlib/component/sprite_component')
local text<const> = require('cartlib/text/text_component')
local artwork_scene<const> = {}

function artwork_scene.register()
	prefab.define({ def_id = 'studio_test.artwork_rectangle', class = object_2d,
		defaults = { width = 48, height = 32, color = 0xffffffff },
		components = { function(owner) return rectangle.new(owner, owner) end } })
	prefab.define({ def_id = 'studio_test.artwork_glyph', class = object_2d,
		scale = { x = 6, y = 6 },
		components = { sprite.factory({ imgid = 'tiny_3b_font_code_0x41', color = 0xffffffff }) } })
	prefab.define({ def_id = 'studio_test.artwork_text', class = object_2d,
		scale = { x = 2, y = 2 },
		defaults = { text = 'WHITE', color = 0xffffffff },
		components = { function(owner) return text.new(owner, owner) end } })

	scenes.register('studio_test.artwork', { objects = {
		{ member_id = 'black_rectangle', definition_id = 'studio_test.artwork_rectangle',
			position = { x = 24, y = 24 }, options = { color = 0xff000000 } },
		{ member_id = 'white_rectangle', definition_id = 'studio_test.artwork_rectangle',
			position = { x = 104, y = 24 }, options = { color = 0xffffffff } },
		{ member_id = 'transparent_glyph', definition_id = 'studio_test.artwork_glyph',
			position = { x = 184, y = 24 } },
		{ member_id = 'white_text', definition_id = 'studio_test.artwork_text',
			position = { x = 24, y = 80 } },
		{ member_id = 'black_text', definition_id = 'studio_test.artwork_text',
			position = { x = 104, y = 80 }, options = { text = 'BLACK', color = 0xff000000 } },
		{ member_id = 'model', definition_id = 'studio_test.mesh', position = { x = 0, y = 0, z = 0 } },
	} })
end

return artwork_scene
