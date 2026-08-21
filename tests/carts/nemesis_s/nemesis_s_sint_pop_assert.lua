local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local update_seconds<const> = clock.gameplay_delta_milliseconds() * 0.001
local movement_tolerance<const> = 1
local approach_step_x<const> = sint_pop_move_to_player_speed_x_px_per_second * update_seconds
local vertical_step_y<const> = sint_pop_move_vertical_up_speed_y_px_per_second * update_seconds
local retreat_step_x<const> = sint_pop_move_away_speed_x_px_per_second * update_seconds

__bmsx_host_test = {
	frames = 0,
	phase = 'await_gameplay',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	test.sint_pops = world:active_definition_view(ids_sint_pop_def)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end
	if test.phase == 'await_gameplay' then
		local players<const> = registry:get(ids_director_instance).players
		for index = 1, #players do
			players[index].body_collider:set_enabled(false)
		end
		test.gameplay_time_ms = world.gameplay_time_ms
		test.phase = 'spawn'
		return false
	end
	if world.gameplay_time_ms == test.gameplay_time_ms then
		return false
	end
	local gameplay_time_ms<const> = world.gameplay_time_ms
	local sint_pops<const> = test.sint_pops.objects

	if test.phase == 'spawn' then
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 500, 'Nemesis S SintPop scenario timed out phase=' .. test.phase)
		if stage.tape_head - 1 < 34 or #sint_pops == 0 then
			return false
		end
		assert(stage.tape_head - 1 == 34, 'SintPop group missed its authored XNA stage column')
		assert(#sint_pops == sint_pop_group_size, 'SintPop marker did not spawn one complete XNA group')
		local formation<const> = sint_pops[1].formation
		assert(formation.remaining == sint_pop_group_size,
			'SintPop formation did not retain its authored member count')
		local formation_x<const> = sint_pops[1].x
		for index = 1, sint_pop_group_size do
			local sint_pop<const> = sint_pops[index]
			assert(sint_pop.formation == formation,
				'SintPop group members did not share one formation state')
			assert(sint_pop.group_type == sint_pop_group_up, 'lowercase p did not produce the upward group')
			assert(sint_pop.x == formation_x + ((index - 1) * sint_pop_width),
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
		if dx == 0 and dy == 0 then
			return false
		end
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 500, 'Nemesis S SintPop scenario timed out phase=' .. test.phase)
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		if dy == 0 then
			assert(math.abs(dx - approach_step_x) <= movement_tolerance,
				'SintPop approach speed changed')
			return false
		end
		assert(math.abs(dx - approach_step_x) <= movement_tolerance,
			'SintPop lost horizontal speed during vertical movement')
		assert(math.abs(dy - vertical_step_y) <= movement_tolerance,
			'upward SintPop group used the wrong vertical speed')
		test.phase = 'vertical'
		return false
	end

	if test.phase == 'vertical' then
		local sint_pop<const> = sint_pops[1]
		local dx<const> = sint_pop.x - test.previous_x
		local dy<const> = sint_pop.y - test.previous_y
		if dx == 0 and dy == 0 then
			return false
		end
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 500, 'Nemesis S SintPop scenario timed out phase=' .. test.phase)
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		if dx > 0 then
			assert(math.abs(dx - retreat_step_x) <= movement_tolerance,
				'SintPop retreat speed changed')
			assert(dy == 0, 'SintPop retained vertical movement while leaving the player')
			test.phase = 'retreat'
			return false
		end
		assert(math.abs(dx - approach_step_x) <= movement_tolerance,
			'SintPop vertical pass used the wrong horizontal speed')
		assert(math.abs(dy - vertical_step_y) <= movement_tolerance,
			'SintPop vertical pass used the wrong vertical speed')
		return false
	end

	if #sint_pops == 0 then
		return true
	end
	return false
end
