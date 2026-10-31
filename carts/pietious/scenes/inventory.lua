local scene_library<const> = require('cartlib/world/scene_library')
require('constants')
local scene<const> = { id = 'pietious.inventory' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				position = { x = 0, y = 32 },
				options = {
					imgid = 'f1_screen',
					id = 'inventory.background',
					space_id = 'item',
				},
			},
			{
				member_id = 'keyworld1',
				definition_id = 'pietious.sprite',
				position = { x = 200, y = 144 },
				options = {
					order = 1,
					imgid = world_item_sprite.keyworld1,
					id = 'inventory.keyworld1',
					space_id = 'item',
				},
			},
			{
				member_id = 'spyglass',
				definition_id = 'pietious.sprite',
				position = { x = 136, y = 168 },
				options = {
					order = 1,
					imgid = world_item_sprite.spyglass,
					id = 'inventory.spyglass',
					space_id = 'item',
				},
			},
			{
				member_id = 'halo',
				definition_id = 'pietious.sprite',
				position = { x = 128, y = 80 },
				options = {
					order = 1,
					imgid = world_item_sprite.halo,
					id = 'inventory.halo',
					space_id = 'item',
				},
			},
			{
				member_id = 'lamp',
				definition_id = 'pietious.sprite',
				position = { x = 128, y = 96 },
				options = {
					order = 1,
					imgid = world_item_sprite.lamp,
					id = 'inventory.lamp',
					space_id = 'item',
				},
			},
			{
				member_id = 'schoentjes',
				definition_id = 'pietious.sprite',
				position = { x = 112, y = 80 },
				options = {
					order = 1,
					imgid = world_item_sprite.schoentjes,
					id = 'inventory.schoentjes',
					space_id = 'item',
				},
			},
			{
				member_id = 'greenvase',
				definition_id = 'pietious.sprite',
				position = { x = 112, y = 96 },
				options = {
					order = 1,
					imgid = world_item_sprite.greenvase,
					id = 'inventory.greenvase',
					space_id = 'item',
				},
			},
			{
				member_id = 'map_world1',
				definition_id = 'pietious.sprite',
				position = { x = 152, y = 144 },
				options = {
					order = 1,
					imgid = world_item_sprite.map_world1,
					id = 'inventory.map_world1',
					space_id = 'item',
				},
			},
			{
				member_id = 'pepernoot',
				definition_id = 'pietious.sprite',
				position = { x = 112, y = 168 },
				options = {
					order = 1,
					imgid = world_item_sprite.pepernoot,
					id = 'inventory.pepernoot',
					space_id = 'item',
				},
			},
			{
				member_id = 'selector',
				definition_id = 'pietious.sprite',
				position = { x = 112, y = 163 },
				options = {
					order = 2,
					imgid = 'f1_selector_white',
					id = 'inventory.selector',
					space_id = 'item',
				},
			},
			{
				member_id = 'map_title',
				definition_id = 'pietious.sprite',
				position = { x = 49, y = 135 },
				options = {
					order = 3,
					imgid = 'f1_map_title',
					id = 'inventory.map_title',
					space_id = 'item',
				},
			},
			{
				member_id = 'map',
				definition_id = 'pietious.map',
				position = { x = 40, y = 148 },
				options = {
					order = 3,
					id = 'inventory.map',
					space_id = 'item',
				},
			},
		},
	})
end

return scene
