local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local registry<const> = require('cartlib/registry')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
require('constants')
local fixture<const> = require('tests/carts/nemesis_s/fixture')

return {
	kind = 'integration',
	tests = {
		sint_pop = function(t)
			local director<const>, stage<const> = fixture.start_game(t)
			local approach_velocity_x<const> = velocity.pixels_per_second_to_velocity_q8(
			sint_pop_move_to_player_speed_x_px_per_second
			)
			local vertical_velocity_y<const> = velocity.pixels_per_second_to_velocity_q8(
			sint_pop_move_vertical_up_speed_y_px_per_second
			)
			local retreat_velocity_x<const> = velocity.pixels_per_second_to_velocity_q8(
			sint_pop_move_away_speed_x_px_per_second
			)

			for index = 1, #director.players do director.players[index].body_collider:set_enabled(false) end
			local sint_pops<const> = world:active_definition_view(ids_sint_pop_def).objects
			t:wait_until('authored SintPop formation', function() return stage.tape_head - 1 >= 34 and #sint_pops > 0 end, 500)
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

			local move_to_player_state<const> = sint_pop.state_machines:bind_state_path('/move_to_player')
			local move_vertical_state<const> = sint_pop.state_machines:bind_state_path('/move_vertical')
			local move_away_state<const> = sint_pop.state_machines:bind_state_path('/move_away_from_player')
			local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
			assert(motion.velocity_x == approach_velocity_x and motion.velocity_y == 0,
			'SintPop approach retained the wrong velocity')

			local state_machines<const> = sint_pop.state_machines
			local previous_x = sint_pop.x
			local previous_y = sint_pop.y
			for tick = 1, 500 do
				if not state_machines:matches_state(move_to_player_state) then break end
				assert(sint_pop.x <= previous_x and sint_pop.y == previous_y,
				'SintPop approach moved outside its retained velocity')
				previous_x = sint_pop.x
				t:wait_ticks(1)
			end
			assert(not state_machines:matches_state(move_to_player_state), 'Timed out: SintPop begins vertical pass')
			do
				assert(state_machines:matches_state(move_vertical_state),
				'SintPop skipped its vertical pass')
				assert(sint_pop.x <= sint_pop_vertical_start_x,
				'SintPop began its vertical pass before the authored X threshold')
				local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
				assert(motion.velocity_x == approach_velocity_x
				and motion.velocity_y == vertical_velocity_y,
				'SintPop vertical pass retained the wrong velocity')

			end
			previous_x = sint_pop.x
			previous_y = sint_pop.y
			for tick = 1, 500 do
				if not state_machines:matches_state(move_vertical_state) then break end
				assert(sint_pop.x <= previous_x and sint_pop.y >= previous_y,
				'SintPop vertical pass moved outside its retained velocity')
				previous_x = sint_pop.x
				previous_y = sint_pop.y
				t:wait_ticks(1)
			end
			assert(not state_machines:matches_state(move_vertical_state), 'Timed out: SintPop begins retreat')
			do
				assert(state_machines:matches_state(move_away_state),
				'SintPop skipped its retreat')
				assert(sint_pop.x <= sint_pop_retreat_start_x,
				'SintPop began its retreat before the authored X threshold')
				local motion<const> = sint_pop:get_component(fixed_point_velocity_component)
				assert(motion.velocity_x == retreat_velocity_x and motion.velocity_y == 0,
				'SintPop retreat retained the wrong velocity')

			end
			previous_x = sint_pop.x
			previous_y = sint_pop.y
			for tick = 1, 500 do
				if not sint_pop.active then break end
				assert(sint_pop.x >= previous_x and sint_pop.y == previous_y,
				'SintPop retreat moved outside its retained velocity')
				previous_x = sint_pop.x
				t:wait_ticks(1)
			end
			assert(not sint_pop.active, 'Timed out: SintPop leaves playfield')

		end,
	},
}
