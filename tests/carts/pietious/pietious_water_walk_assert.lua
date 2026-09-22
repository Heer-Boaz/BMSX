local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
require('constants')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		water_walk = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local test<const> = {}
			castle.current_room_number = 8
			room = castle:load_room(8)
			local probe_x
			local probe_y
			for tx = 1, room.tile_columns do
				local x<const> = room.tile_origin_x + ((tx - 1) * room.tile_size) - room_tile_half
				for ty = 13, room.tile_rows do
					local y<const> = room.tile_origin_y + ((ty - 1) * room.tile_size) - player.height
					if room:player_water_kind_at_world(x + room_tile_half, y + player.height) == water_body
					and not room:has_collision_flags_in_rect(
					x, y, player.width + (room_tile_size * 3), player.height, collision_flags_solid_mask, false
					)
					and player:is_support_below_at(x, y, true)
					then
						probe_x = x
						probe_y = y
						break
					end
				end
				if probe_x ~= nil then
					break
				end
			end
			assert(probe_x ~= nil, 'no underwater walking probe found in room 8')
			player:clear_input_state()
			player:zero_motion()
			player:reset_fall_substate_sequence()
			player:cancel_sword()
			player.status.inventory_items.schoentjes = true
			player.x = probe_x
			player.y = probe_y
			player.facing = 1
			player.walk_x_fraction = 0
			player.walk_animation_phase = 0
			player.walk_frame = 0
			player.state_machines:transition_to('/walking_right')
			player:sync_water_state()
			assert(player.water_state == water_body, 'setup did not place player in body water')
			test.walking_state = player.state_machines:bind_state_path('/walking_right')
			test.start_x = player.x

			t:down('ArrowRight')
			t:wait_until('underwater walking input', function()
				return player.right_held and player.state_machines:matches_state(test.walking_state)
			end, 30)
			for sample = 1, 8 do
				local dx<const> = player.last_dx
				assert(dx == 0 or dx == 1, 'underwater walk moved by ' .. dx .. ' pixels in one update')
				if sample < 8 then t:wait_ticks(1) end
			end
			local distance<const> = player.x - test.start_x
			assert(distance == 2, 'underwater walk moved ' .. distance .. ' pixels over four gameplay updates')
			assert(player.walk_frame == 1, 'underwater walk animation did not advance after four updates')
			t:up('ArrowRight')

		end,
	},
}
