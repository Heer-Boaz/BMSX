local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')
local scene_library<const> = require('cartlib/world/scene_library')
local castle_map<const> = require('castle/map')
local castle_module<const> = require('castle/castle')
local fixture<const> = require('tests/carts/pietious/fixture')
local terrain<const> = require('room/terrain')
require('constants')

return {
	kind = 'integration',
	tests = {
		room_terrain_revision = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room<const> = castle.room
			local base<const> = room.template.terrain.base
			assert(room.room_tile_layer.tape_rows == terrain.tape + base.tape,
				'an ordinary room reprojects its immutable terrain during activation')
			progression.set(castle, 'r109.stairs', true)
			local opened<const> = castle:load_room(109)
			local stair_x<const>, stair_y<const> = opened:tile_to_world(30, 18)
			assert(player:search_stairs_at_locked_x(stair_x, stair_y) == nil,
				'the room base already admitted the progression stair')
			castle:commit_room_switch({ from_room_number = 1, to_room_number = 109, direction = 'right' }, 1, 0, 0)
			local stair_layout<const> = opened.template.terrain.stairs_open
			assert(player:search_stairs_at_locked_x(stair_x, stair_y) ~= nil
				and opened.room_tile_layer.tape_rows == terrain.tape + stair_layout.tape,
				'the real room-enter rule did not publish both of the opened stairs surfaces')
			local sealed<const> = castle:load_room(100)
			castle:commit_room_switch({ from_room_number = 109, to_room_number = 100, direction = 'down' }, 1, 0, 0)
			local intact<const> = sealed.template.terrain.base
			assert(sealed:has_collision_flags_at_tile(1, 4, collision_flags_wall),
				'the intact seal did not block its authored cells')
			sealed.room_dissolve_step = #intact.dissolve
			sealed:rebuild_room_tiles()
			assert(sealed:has_collision_flags_at_tile(1, 4, collision_flags_wall)
				and sealed.room_tile_layer.tape_rows == terrain.tape + intact.dissolve[#intact.dissolve],
				'the dissolve must change the visual tape before changing collision')
			castle:finish_seal_dissolution()
			local cleared<const> = sealed.template.terrain.seal_cleared
			assert(not sealed:has_collision_flags_at_tile(1, 4, collision_flags_wall)
				and sealed.room_tile_layer.tape_rows == terrain.tape + cleared.dissolve[#cleared.dissolve],
				'ending the dissolve did not clear both the render and collision cells')
		end,
		room_collision_rock_stairs_and_water = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room<const> = castle:load_room(13)
			castle:commit_room_switch({ from_room_number = 1, to_room_number = 13, direction = 'right' }, 0, 0, 0)
			assert(room.tiles_visible and room.water_tile_layer == nil and room.timelines == nil,
				'a dry room must present its terrain without scheduling a water effect')
			local tx<const>, ty<const> = 27, 11
			local x<const>, y<const> = room:tile_to_world(tx, ty)
			local rock<const> = room.scene.members.rock_013_01
			local rock_x<const>, rock_y<const> = rock:get_global_position()
			assert(rock_x == x and rock_y == y, 'the real rock and collision fixture no longer share a tile')
			assert(room:base_collision_flags_at_tile(tx + 1, ty + 1) == collision_flags_wall
				and room:overlaps_solid_rect(x + 15, y + 15, 1, 1)
				and not room:overlaps_solid_rect(x - 1, y, 1, 1),
				'live rock has lost its exact 2x2 solid footprint')
			player:set_global_position(x, y)
			assert(player:pick_entry_stairs(-1) == nil and player:search_stairs_at_locked_x(x, y) == nil,
				'a rock-covered stair can be entered from its blocked end')

			rock:begin_break()
			assert(room.progress.destroyed_rocks.rock_013_01
				and room:base_collision_flags_at_tile(tx + 1, ty + 1) == collision_flags_none
				and not room:overlaps_solid_rect(x + 15, y + 15, 1, 1),
				'breaking the rock did not remove the matching collision cells')
			local stair<const> = player:pick_entry_stairs(-1)
			assert(stair ~= nil and stair == player:search_stairs_at_locked_x(x, y),
				'the real rock break did not restore both player stair queries')
			player:apply_stairs_lock(stair)
			assert(player.stairs_x == x and player.stairs_bottom_y == y and player.stairs_top_y == y - 56,
				'the restored stair has different world bounds')
			local restored<const> = castle:load_room(13)
			castle:commit_room_switch({ from_room_number = 13, to_room_number = 13, direction = 'right' }, 0, 0, 0)
			assert(restored.scene.members.rock_013_01 == nil and restored.scene.members.rock_013_02 ~= nil
				and player:search_stairs_at_locked_x(x, y) == stair,
				'reentry did not use the independently retained rock state')

			local wet<const> = castle:load_room(8)
			castle:commit_room_switch({ from_room_number = 13, to_room_number = 8, direction = 'right' }, 0, 0, 0)
			local surface_x<const>, surface_y<const> = wet:tile_to_world(2, wet.water.surface_row)
			local wall_x<const>, wall_y<const> = wet:tile_to_world(32, wet.water.surface_row)
			assert(wet:water_kind_at_world(surface_x, surface_y) == water_surface
				and wet:water_kind_at_world(surface_x, surface_y + room_tile_size) == water_body
				and wet:water_kind_at_world(wall_x, wall_y) == water_none
				and wet:base_collision_flags_at_tile(32, wet.water.surface_row) == collision_flags_wall,
				'visible water ignores the compiled collision at the rightmost wall')
			local floor_x<const>, floor_y<const> = wet:tile_to_world(2, wet.tile_rows)
			assert(wet:water_kind_at_world(floor_x, floor_y) == water_none
				and wet:player_water_kind_at_world(floor_x, floor_y) == water_body,
				'the player water plane changed at the submerged support tile')
			assert(wet.water_tile_layer.visible and wet.water_surface_tile_count > 0,
				'wet room activation did not publish its water layer')
		end,
		room_reload = function(t)
			t:wait_until('intro director', function() return registry:get('d') ~= nil end, 120)
			t:at_boundary(world:request_mutation_boundary(), 120)
			assert(registry:get('d'):reload_room() == 'Return to room gameplay before reloading its scene.',
			'intro reload replaced a room owned by another flow')
			local _director<const>, castle<const> = fixture.start_game(t)
			castle:switch_room('right')
			t:at_boundary(world:request_mutation_boundary(), 30)
			local previous<const> = castle.room
			local old_scene<const> = previous.scene
			local old_scene_plan<const> = old_scene.definition
			local old_level<const> = castle.level
			local player<const> = castle.player
			local session<const> = castle.session
			local x<const>, y<const> = player.ox, player.oy
			local map_x<const>, map_y<const> = previous.map_x, previous.map_y
			local state<const> = session.progression
			session.player.health = 13
			session.player.inventory_items.schoentjes = true
			previous.progress.destroyed_rocks.rock_002_02 = true
			progression.set(castle, 'item_picked_drop.rock_002_02', true)
			local enemy<const> = old_scene.members.enemy_002_01
			local rock<const> = old_scene.members.rock_002_01
			-- Repeat the same definition registration performed by <init> at Hot Resume.
			castle_map.initialize()
			local template<const> = castle_map.definition.rooms[2]
			template.rocks[1].position.x = 120
			scene_library.register(template.scene_id, template.scene_definition)
			castle_module.register_castle_definition()
			assert(castle.level == old_level and old_level ~= castle_module.castle.level,
			'registration changed the active controller revision')
			assert(previous.enemies[1] == old_level.map.rooms[2].enemies[1]
			and old_scene.definition == old_scene_plan
			and old_scene_plan ~= scene_library.definition(template.scene_id),
			'old scene mixes different definition revisions')
			assert(progression.matches(castle, old_level.filters[previous.enemies[1]]), 'old conditions became unreadable after registration')
			assert(rock.ox == 104 and previous.rocks[1].position.x == 104, 'registration mutated an existing scene')
			assert(registry:get('d'):reload_room() == 'Room reloaded; game progress and player position retained.', 'reload method refused settled gameplay')
			local room<const> = castle.room
			assert(room ~= previous and previous.world == nil and #old_scene.objects.items == 0 and old_scene.closed,
			'outgoing room/scene was retained')
			assert(enemy.world == nil and rock.world == nil and room.scene.members.enemy_002_01 ~= enemy,
			'reload did not reconstruct transient actors')
			assert(room.scene.members.rock_002_01.ox == 120, 'reload ignored the latest authored placement')
			assert(castle.level == castle_module.castle.level and room.template == castle.level.map.rooms[2], 'reload retained the old definition')
			assert(castle.session == session and session.progression == state and castle.player == player and player.room == room,
			'reload replaced the session or travelling player')
			assert(player.ox == x and player.oy == y and room.map_x == map_x and room.map_y == map_y, 'reload moved the player or map position')
			assert(player.status.health == 13 and player.status.inventory_items.schoentjes
			and progression.get(castle, 'item_picked_drop.rock_002_02') and room.progress.destroyed_rocks.rock_002_02,
			'reload reset player or room progress')
			assert(room.scene.members.rock_002_02 == nil and room.scene.members['drop.rock_002_02'] == nil,
			'reload resurrected collected terrain')
			assert(room.tiles_visible and room.room_tile_count > 0, 'reconstructed room is invisible')
			-- Repeated reload does not accumulate actors or subscriptions.
			local count<const> = #room.scene.objects.items
			registry:get('d'):reload_room()
			assert(#room.scene.objects.items == 0 and #castle.room.scene.objects.items == count, 'repeated reload leaked members')

		end,
	},
}
