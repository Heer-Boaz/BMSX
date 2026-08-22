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
	local player_state<const> = player.player_state

	for _ = 1, 4 do
		player_state.current_powerup_slot = player_state_module.powerup_slot.option
		assert(player_state:activate_selected_powerup() == player_state_module.powerup_slot.option)
	end
	assert(#player.options == 4, 'option power-ups did not add four player option vessels')
	assert(player.primary_projectiles[2].type == 0
		and player.primary_projectiles[3].type == 0
		and player.primary_projectiles[4].type == 0
		and player.primary_projectiles[5].type == 0,
		'new option vessels did not retain their projectile slots')

	player.right_held = true
	for step = 1, 32 do
		player.x = 80 + step
		player:update_options()
	end
	assert(player.option_history_index == 1, 'option history did not wrap after thirty-two movement samples')
	assert(player.options[1].x == 105
		and player.options[2].x == 97
		and player.options[3].x == 89
		and player.options[4].x == 81,
		'options did not consume successive eight-sample history segments')
	local first_option_x<const> = player.options[1].x
	local second_option_x<const> = player.options[2].x
	local third_option_x<const> = player.options[3].x
	local fourth_option_x<const> = player.options[4].x
	player_state:advance_powerup_selection()
	assert(player.options[1].x == first_option_x
		and player.options[2].x == second_option_x
		and player.options[3].x == third_option_x
		and player.options[4].x == fourth_option_x,
		'power-up selection reset the retained option history positions')

	player.right_held = false
	player:update_options()
	assert(player.option_history_index == 1,
		'option history advanced without a valid movement direction')
	return true
end
