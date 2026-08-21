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

	speed_levels[speed_slot] = 0
	player.x = 0
	player.y = 60
	player.left_held = true
	player.right_held = true
	player.up_held = false
	player.down_held = false
	player:update_position()
	assert(player.x == 0 and player.last_dx == 0,
		'opposing horizontal inputs escaped the zero-vector A902 table entry')

	player.x = 80
	player.y = 60
	player.left_held = false
	player.right_held = false
	player.up_held = true
	player.down_held = true
	player:update_position()
	assert(player.y == 60 and player.last_dy == 0,
		'opposing vertical inputs escaped the zero-vector A902 table entry')
	return true
end
