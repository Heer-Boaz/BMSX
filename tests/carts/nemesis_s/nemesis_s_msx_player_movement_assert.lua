local fixture<const> = require('tests/carts/nemesis_s/fixture')
local player_state_module<const> = require('player/player_state')

return {
	kind = 'integration',
	tests = {
		movement_uses_speed_table_and_opposed_inputs = function(t)
			local _director<const>, _stage<const>, player<const> = fixture.start_game(t)
			local pose<const> = player.spatial:resolve_world()
			player.left_held = false
			player.right_held = true
			player.up_held = false
			player.down_held = false
			local speed_levels<const> = player.player_state.powerup_levels
			local speed_slot<const> = player_state_module.powerup_slot.speed
			for level = 0, player_state_module.powerup_max_levels[speed_slot] do
				speed_levels[speed_slot] = level
				pose:set_world_origin(80, pose.woy)
				player:update_position()
				pose:resolve_world()
				local expected_step<const> = 2 + level * 0.5
				assert(pose.wox == 80 + expected_step and player.last_speed == expected_step,
				'the player lost the A902 Q8.8 movement scale at speed level ' .. tostring(level))
			end

			speed_levels[speed_slot] = 0
			pose:set_world_origin(0, 60)
			player.left_held = true
			player.right_held = true
			player.up_held = false
			player.down_held = false
			player:update_position()
			pose:resolve_world()
			assert(pose.wox == 0 and player.last_dx == 0,
			'opposing horizontal inputs escaped the zero-vector A902 table entry')

			pose:set_world_origin(80, 60)
			player.left_held = false
			player.right_held = false
			player.up_held = true
			player.down_held = true
			player:update_position()
			pose:resolve_world()
			assert(pose.woy == 60 and player.last_dy == 0,
			'opposing vertical inputs escaped the zero-vector A902 table entry')
		end,
	},
}
