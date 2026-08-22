local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local registry<const> = require('cartlib/registry')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
require('constants')

local approach_velocity_x<const> = velocity.pixels_per_second_to_velocity_q8(
	sint_pop_move_to_player_speed_x_px_per_second
)
local vertical_velocity_y<const> = velocity.pixels_per_second_to_velocity_q8(
	sint_pop_move_vertical_up_speed_y_px_per_second
)
local retreat_velocity_x<const> = velocity.pixels_per_second_to_velocity_q8(
	sint_pop_move_away_speed_x_px_per_second
)

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
		local sint_pop<const> = sint_pops[1]
		test.sint_pop = sint_pop
		test.move_to_player_state = sint_pop.state_machines:bind_state_path('/move_to_player')
		test.move_vertical_state = sint_pop.state_machines:bind_state_path('/move_vertical')
		test.move_away_state = sint_pop.state_machines:bind_state_path('/move_away_from_player')
		local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
		assert(motion.velocity_x == approach_velocity_x and motion.velocity_y == 0,
			'SintPop approach retained the wrong velocity')
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		test.phase = 'approach'
		return false
	end
	test.gameplay_time_ms = gameplay_time_ms
	test.frames = test.frames + 1
	assert(test.frames < 500, 'Nemesis S SintPop scenario timed out phase=' .. test.phase)

	if test.phase == 'approach' then
		local sint_pop<const> = test.sint_pop
		local state_machines<const> = sint_pop.state_machines
		if state_machines:matches_state(test.move_to_player_state) then
			assert(sint_pop.x <= test.previous_x and sint_pop.y == test.previous_y,
				'SintPop approach moved outside its retained velocity')
			test.previous_x = sint_pop.x
			return false
		end
		assert(state_machines:matches_state(test.move_vertical_state),
			'SintPop skipped its vertical pass')
		assert(sint_pop.x <= sint_pop_vertical_start_x,
			'SintPop began its vertical pass before the authored X threshold')
		local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
		assert(motion.velocity_x == approach_velocity_x
			and motion.velocity_y == vertical_velocity_y,
			'SintPop vertical pass retained the wrong velocity')
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		test.phase = 'vertical'
		return false
	end

	if test.phase == 'vertical' then
		local sint_pop<const> = test.sint_pop
		local state_machines<const> = sint_pop.state_machines
		if state_machines:matches_state(test.move_vertical_state) then
			assert(sint_pop.x <= test.previous_x and sint_pop.y >= test.previous_y,
				'SintPop vertical pass moved outside its retained velocity')
			test.previous_x = sint_pop.x
			test.previous_y = sint_pop.y
			return false
		end
		assert(state_machines:matches_state(test.move_away_state),
			'SintPop skipped its retreat')
		assert(sint_pop.x <= sint_pop_retreat_start_x,
			'SintPop began its retreat before the authored X threshold')
		local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
		assert(motion.velocity_x == retreat_velocity_x and motion.velocity_y == 0,
			'SintPop retreat retained the wrong velocity')
		test.previous_x = sint_pop.x
		test.previous_y = sint_pop.y
		test.phase = 'retreat'
		return false
	end

	local sint_pop<const> = test.sint_pop
	if not sint_pop.active then
		return true
	end
	assert(sint_pop.x >= test.previous_x and sint_pop.y == test.previous_y,
		'SintPop retreat moved outside its retained velocity')
	test.previous_x = sint_pop.x
	return false
end
