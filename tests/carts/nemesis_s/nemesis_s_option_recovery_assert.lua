local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local player_state<const> = require('player/player_state')
require('constants')

local selected_apu_source<const>: *word = 0x0800018c
local option_pickup_source<const> = rom_dir.audio('nemesis3_option_take').addr
local option_slot<const> = player_state.powerup_slot.option

__bmsx_host_test = {
	frames = 0,
	phase = 'setup',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
	__bmsx_host_test.pickups = world:active_definition_view(ids_option_pickup_def)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 80, 'Nemesis S option-recovery scenario timed out phase=' .. test.phase)

	local player<const> = registry:get(player_starts[1].id)
	if player == nil or world.active_space_id ~= 'main' then
		return false
	end

	if test.phase == 'setup' then
		player.player_state.current_powerup_slot = option_slot
		assert(player.player_state:activate_selected_powerup() == option_slot)
		player.player_state.current_powerup_slot = option_slot
		assert(player.player_state:activate_selected_powerup() == option_slot)
		player.options[1].x = 20
		player.options[1].y = 40
		player.options[2].x = 200
		player.options[2].y = 80
		test.animation_frame = player.option_anim_index
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'animation'
		return false
	end

	if test.phase == 'animation' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		assert(player.option_anim_index ~= test.animation_frame,
			'option animation did not advance at the retained gameplay cadence')
		player.state_machines:transition_to('/dying')
		assert(player.player_state.powerup_levels[option_slot] == 0,
			'player death did not clear the equipped options')
		assert(#player.options == 0, 'player death retained attached option vessels')
		local pickups<const> = test.pickups.objects
		assert(#pickups == 2, 'player death did not publish one pickup per option')
		assert(pickups[1].x == 148 and pickups[1].y == 40,
			'first option pickup did not retain the authored XNA displacement')
		assert(pickups[2].x == playfield_width and pickups[2].y == 80,
			'second option pickup did not clamp at the playfield edge')
		test.pickup_x = pickups[1].x
		test.animation_frame = player.option_anim_index
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'floating'
		return false
	end

	if test.phase == 'floating' then
		if world.gameplay_time_ms == test.gameplay_time_ms then
			return false
		end
		local pickups<const> = test.pickups.objects
		assert(pickups[1].x == test.pickup_x - 1,
			'detached option did not consume its retained fixed-point velocity')
		assert(player.option_anim_index ~= test.animation_frame,
			'option animation stopped while the player death state was active')
		player.state_machines:transition_to('/active/flying')
		pickups[1].x = player.x
		pickups[1].y = player.y
		pickups[2].y = playfield_height
		test.phase = 'collect_first'
		return false
	end

	if test.phase == 'collect_first' then
		if #test.pickups.objects == 2 then
			return false
		end
		assert(player.player_state.powerup_levels[option_slot] == 1,
			'detached option did not restore the concrete option power-up')
		assert(#player.options == 1,
			'option pickup did not restore one retained option vessel')
		assert(*selected_apu_source == option_pickup_source,
			'option pickup did not select the authored XNA retrieval cue')
		local pickup<const> = test.pickups.objects[1]
		pickup.x = player.x
		pickup.y = player.y
		test.phase = 'collect_second'
		return false
	end

	if #test.pickups.objects > 0 then
		return false
	end
	assert(player.player_state.powerup_levels[option_slot] == 2,
		'second detached option did not restore the authored maximum')
	assert(#player.options == 2,
		'second option pickup did not restore the second option vessel')
	return true
end
