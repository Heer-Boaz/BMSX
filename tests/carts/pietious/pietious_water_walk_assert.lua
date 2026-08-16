local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
	sample_count = 0,
	total_dx = 0,
}

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil and registry:get('pietolon') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 300, 'water walk scenario timed out phase=' .. test.phase)
	if world.active_space_id ~= 'main' then
		return false
	end

	local castle<const> = registry:get('c')
	local room<const> = registry:get('room')
	local player<const> = registry:get('pietolon')
	if test.phase == 'setup' then
		castle.current_room_number = 8
		room:load_room(8)
		castle.world_entrance_states = {}
		castle:sync_world_entrance_states_for_room(room)
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
		player.inventory_items.schoentjes = false
		player.x = probe_x
		player.y = probe_y
		player.facing = 1
		player.walk_speed_accum = 0
		player.state_machines:transition_to('/walking_right')
		player:sync_water_state()
		assert(player.water_state == water_body, 'setup did not place player in body water')
		test.walking_state = player.state_machines:bind_state_path('/walking_right')
		test.phase = 'sample'
		return host.down('ArrowRight')
	end

	if test.phase == 'sample' then
		if not player.right_held or not player.state_machines:matches_state(test.walking_state) then
			return false
		end
		local dx<const> = player.last_dx
		assert(dx == 0 or dx == 1, 'underwater ground walk moved by ' .. dx .. ' pixels in one frame')
		test.sample_count = test.sample_count + 1
		test.total_dx = test.total_dx + dx
		if test.sample_count < 4 then
			return false
		end
		assert(test.total_dx == 2, 'underwater ground walk moved ' .. test.total_dx .. ' pixels over four frames')
		test.phase = 'release'
		return host.up('ArrowRight')
	end

	return true
end
