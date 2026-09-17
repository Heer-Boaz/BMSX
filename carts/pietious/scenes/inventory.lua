local scene_library<const> = require('cartlib/world/scene_library')
require('constants')
local scene<const> = { id = 'pietious.inventory' }

function scene.register()
	scene_library.register(scene.id, {
		objects = {
			{
				member_id = 'background',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.background',
					space_id = 'item',
					pos = { x = 0, y = 32, z = 0 },
					imgid = 'f1_screen',
				},
			},
			{
				member_id = 'keyworld1',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.keyworld1',
					space_id = 'item',
					pos = { x = 200, y = 144, z = 1 },
					imgid = world_item_sprite.keyworld1,
				},
			},
			{
				member_id = 'spyglass',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.spyglass',
					space_id = 'item',
					pos = { x = 136, y = 168, z = 1 },
					imgid = world_item_sprite.spyglass,
				},
			},
			{
				member_id = 'halo',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.halo',
					space_id = 'item',
					pos = { x = 128, y = 80, z = 1 },
					imgid = world_item_sprite.halo,
				},
			},
			{
				member_id = 'lamp',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.lamp',
					space_id = 'item',
					pos = { x = 128, y = 96, z = 1 },
					imgid = world_item_sprite.lamp,
				},
			},
			{
				member_id = 'schoentjes',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.schoentjes',
					space_id = 'item',
					pos = { x = 112, y = 80, z = 1 },
					imgid = world_item_sprite.schoentjes,
				},
			},
			{
				member_id = 'greenvase',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.greenvase',
					space_id = 'item',
					pos = { x = 112, y = 96, z = 1 },
					imgid = world_item_sprite.greenvase,
				},
			},
			{
				member_id = 'map_world1',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.map_world1',
					space_id = 'item',
					pos = { x = 152, y = 144, z = 1 },
					imgid = world_item_sprite.map_world1,
				},
			},
			{
				member_id = 'pepernoot',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.pepernoot',
					space_id = 'item',
					pos = { x = 112, y = 168, z = 1 },
					imgid = world_item_sprite.pepernoot,
				},
			},
			{
				member_id = 'selector',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.selector',
					space_id = 'item',
					pos = { x = 112, y = 163, z = 2 },
					imgid = 'f1_selector_white',
				},
			},
			{
				member_id = 'map_title',
				definition_id = 'pietious.sprite',
				options = {
					id = 'inventory.map_title',
					space_id = 'item',
					pos = { x = 49, y = 135, z = 3 },
					imgid = 'f1_map_title',
				},
			},
			{
				member_id = 'map',
				definition_id = 'pietious.map',
				options = {
					id = 'inventory.map',
					space_id = 'item',
					pos = { x = 40, y = 148, z = 3 },
				},
			},
		},
	})
end

return scene
