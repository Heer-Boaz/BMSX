local registry<const> = require('cartlib/registry')
local player_state_module<const> = require('player/player_state')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get('nemesis_s.director')
	director.state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	local player<const> = registry:get('nemesis_s.player.1')
	if player == nil then
		return false
	end

	player.left_held = false
	player.right_held = true
	player.up_held = false
	player.down_held = false
	local speed_levels<const> = player.player_state.powerup_levels
	local speed_slot<const> = player_state_module.powerup_slot.speed
	for level = 0, player_state_module.powerup_max_levels[speed_slot] do
		speed_levels[speed_slot] = level
		player.x = 80
		player:update_position()
		local expected_step<const> = 2 + level * 0.5
		assert(player.x == 80 + expected_step and player.last_speed == expected_step,
			'the player lost the A902 Q8.8 movement scale at speed level ' .. tostring(level))
	end
	return true
end
