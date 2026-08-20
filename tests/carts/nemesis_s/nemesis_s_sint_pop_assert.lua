local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
	test.sint_pops = world:active_definition_view(ids_sint_pop_def)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 500, 'Nemesis S SintPop scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end
	local sint_pops<const> = test.sint_pops.objects

	if test.phase == 'spawn' then
		if stage.tape_head - 1 < 34 then
			return false
		end
		assert(stage.tape_head - 1 == 34, 'SintPop group missed its authored XNA stage column')
		assert(#sint_pops == sint_pop_group_size, 'SintPop marker did not spawn one complete XNA group')
		for index = 1, sint_pop_group_size do
			local sint_pop<const> = sint_pops[index]
			assert(sint_pop.group_id == 34, 'SintPop group identity no longer follows the marker column')
			assert(sint_pop.group_type == sint_pop_group_up, 'lowercase p did not produce the upward group')
			assert(sint_pop.x == playfield_width + ((index - 1) * sint_pop_width),
				'SintPop group spacing no longer matches the XNA formation')
			assert(sint_pop.y == 16, 'SintPop group no longer uses the authored map row')
		end
		stage.scrolling = false
		test.previous_x = sint_pops[1].x
		test.previous_y = sint_pops[1].y
		test.phase = 'approach'
		return false
	end

	if test.phase == 'approach' then
		local sint_pop<const> = sint_pops[1]
		local dx<const> = sint_pop.x - test.previous_x
		local dy<const> = sint_pop.y - test.previous_y
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		if dy == 0 then
			assert(dx == sint_pop_move_to_player_speed_x, 'SintPop approach speed changed')
			return false
		end
		assert(dx == sint_pop_move_to_player_speed_x, 'SintPop lost horizontal speed during vertical movement')
		assert(dy == sint_pop_move_vertical_up_speed_y, 'upward SintPop group used the wrong vertical speed')
		test.phase = 'vertical'
		return false
	end

	if test.phase == 'vertical' then
		local sint_pop<const> = sint_pops[1]
		local dx<const> = sint_pop.x - test.previous_x
		local dy<const> = sint_pop.y - test.previous_y
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		if dx == sint_pop_move_away_speed_x then
			assert(dy == 0, 'SintPop retained vertical movement while leaving the player')
			test.phase = 'retreat'
			return false
		end
		assert(dx == sint_pop_move_to_player_speed_x, 'SintPop vertical pass used the wrong horizontal speed')
		assert(dy == sint_pop_move_vertical_up_speed_y, 'SintPop vertical pass used the wrong vertical speed')
		return false
	end

	if #sint_pops == 0 then
		return true
	end
	return false
end
