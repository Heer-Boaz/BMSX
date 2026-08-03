local behaviour_tree_system<const> = require('cartlib/ecs/systems/behaviour_tree')
local boundary_system<const> = require('cartlib/ecs/systems/boundary')
local input_action_effect_system<const> = require('cartlib/input/action_effect/system')
local object_fsm_system<const> = require('cartlib/ecs/systems/object_fsm')
local overlap_2d_system<const> = require('cartlib/ecs/systems/overlap_2d')
local prefab<const> = require('cartlib/prefab')
local previous_position_system<const> = require('cartlib/ecs/systems/previous_position')
local progression<const> = require('cartlib/progression')
local tile_collision_system<const> = require('cartlib/ecs/systems/tile_collision')
local timeline_system<const> = require('cartlib/ecs/systems/timeline')
local world_instance<const> = require('cartlib/world/world').instance
local castle_map<const> = require('castle/map')
local elevator_update_system<const> = require('elevator/update_system')
require('constants')
require('enemies/boekfoe')
require('enemies/breakablewall')
require('enemies/cloud')
require('enemies/crossfoe')
require('enemies/disappearingwall')
require('enemies/marspeinenaardappel')
require('enemies/mijterfoe')
require('enemies/muziekfoe')
require('enemies/nootfoe')
require('enemies/paperfoe')
require('enemies/stafffoe')
require('enemies/staffspawn')
require('enemies/vlokfoe')
require('enemies/vlokspawner')
require('enemies/zakfoe')
require('pietious_font')
require('player/player')
require('room/room')
require('draaideur')
require('transition')
require('shrine')
require('seal')
require('lithograph/lithograph')
require('lithograph/screen')
require('item_screen')
require('ui')
require('loot_drop')
require('world/item')
require('rock')
require('pepernoot_projectile')
require('enemy/explosion')
require('elevator/elevator')
require('castle/castle')
require('world/entrance')
require('daemon_cloud')
require('director')
require('title_screen')

local world_systems<const> = {
	previous_position_system,
	behaviour_tree_system,
	input_action_effect_system,
	object_fsm_system,
	boundary_system,
	overlap_2d_system,
	tile_collision_system,
	timeline_system,
	elevator_update_system,
}

local grant_starting_loadout<const> = function()
	local player<const> = world_instance:get('pietolon')
	player.inventory_items['keyworld1'] = true
	player.inventory_items['spyglass'] = true
	player.inventory_items['halo'] = true
	player.inventory_items['lamp'] = true
	player.inventory_items['schoentjes'] = true
	player.inventory_items['greenvase'] = true
	player.inventory_items['map_world1'] = true
	player.inventory_items['pepernoot'] = true
	player:equip_subweapon('pepernoot')
	player.weapon_level = hud_weapon_level
	player:emit_weapon_changed()
	local castle<const> = world_instance:get('c')
	progression.set(castle, 'staff1destroyed', true)
	progression.set(castle, 'staff2destroyed', true)
	progression.set(castle, 'staff3destroyed', true)
end

local start<const> = function(director_boot_mode)
	world_instance.systems:replace(world_systems)
	world_instance:clear()
	world_instance:add_space('main')
	world_instance:add_space('title')
	world_instance:add_space('transition')
	world_instance:add_space('shrine')
	world_instance:add_space('lithograph')
	world_instance:add_space('item')
	world_instance:add_space('ui')
	world_instance:set_space('main')

	local castle<const> = prefab.spawn('castle', { id = 'c', })

	prefab.spawn('room', { id = 'room', })

	prefab.spawn('player', {
		id = 'pietolon',
		pos = { x = player_start_x, y = player_start_y, z = 140 },
	})
	grant_starting_loadout()
	castle:initialize(castle_map.start_room_number, director_boot_mode ~= 'title_screen')

	prefab.spawn('transition', { id = 'transition', space_id = 'transition', })
	prefab.spawn('shrine', { id = 'shrine', space_id = 'shrine', })
	prefab.spawn('lithograph_screen', { id = 'lithograph', space_id = 'lithograph', })
	prefab.spawn('item_screen', { id = 'item_screen', space_id = 'item', })
	prefab.spawn('ui', { id = 'ui', pos = { z = draw_z_hud }, })
	prefab.spawn('title_screen', { id = 'title_screen', space_id = 'title', })
	prefab.spawn('director', { id = 'd', boot_mode = director_boot_mode, pos = { z = draw_z_director_effect }, })
end

return {
	start = start,
}
