local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local update_seconds<const> = clock.update_milliseconds() * 0.001
local movement_tolerance<const> = 1

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
	test.mijter_foes = world:active_definition_view(ids_mijter_foe_def)
	test.gameplay_time_ms = world.gameplay_time_ms
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end
	if world.gameplay_time_ms == test.gameplay_time_ms then
		return false
	end
	test.gameplay_time_ms = world.gameplay_time_ms
	test.frames = test.frames + 1
	assert(test.frames < 700, 'Nemesis S MijterFoe scenario timed out phase=' .. test.phase)
	local mijter_foes<const> = test.mijter_foes.objects

	if test.phase == 'spawn' then
		if stage.tape_head - 1 < 56 then
			return false
		end
		assert(stage.tape_head - 1 == 56, 'MijterFoe missed its authored XNA stage column')
		assert(#mijter_foes == 1, 'MijterFoe marker did not spawn exactly one actor')
		local foe<const> = mijter_foes[1]
		assert(foe.mijter_type == mijter_foe_type_red, 'uppercase M did not produce the red MijterFoe')
		assert(foe.sprite_component.imgid == assets_mijter_foe_red_neutral, 'MijterFoe started with the wrong image')
		assert(foe.x == playfield_width, 'MijterFoe no longer enters at the playfield edge')
		assert(foe.y == 40, 'MijterFoe no longer uses the XNA row offset')
		stage.scrolling = false
		test.previous_x = foe.x
		test.previous_y = foe.y
		test.phase = 'default'
		return false
	end

	if test.phase == 'default' then
		local foe<const> = mijter_foes[1]
		local dx<const> = foe.x - test.previous_x
		local dy<const> = foe.y - test.previous_y
		test.previous_x = foe.x
		test.previous_y = foe.y
		assert(math.abs(
			dx + mijter_foe_default_speed_px_per_second * update_seconds
		) <= movement_tolerance, 'MijterFoe approach speed changed')
		assert(dy == 0, 'MijterFoe moved vertically before choosing its attack line')
		if foe.sprite_component.imgid == assets_mijter_foe_red_neutral then
			return false
		end
		assert(foe.sprite_component.imgid == assets_mijter_foe_red_down,
			'MijterFoe selected the wrong attack image for a target below it')
		test.phase = 'attack'
		return false
	end

	if test.phase == 'attack' then
		local foe<const> = mijter_foes[1]
		local dx<const> = foe.x - test.previous_x
		assert(math.abs(
			dx + mijter_foe_attack_speed_px_per_second * update_seconds
		) <= movement_tolerance, 'MijterFoe attack vector lost its dominant-axis speed')
		assert(foe.motion.velocity_y > 0 and foe.motion.velocity_y < -foe.motion.velocity_x,
			'MijterFoe attack vector no longer targets the selected player')
		test.phase = 'dispose'
		return false
	end

	return #mijter_foes == 0
end
