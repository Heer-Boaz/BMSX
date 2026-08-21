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
		assert(foe.drop_definition_id == ids_roodje_def, 'red MijterFoe no longer drops a capsule')
		assert(foe.motion.velocity_x == mijter_foe_velocity_x_q8,
			'MijterFoe did not acquire the Nemesis 2 Sodom horizontal word')
		assert(foe.motion.velocity_y == 0, 'MijterFoe did not start with zero vertical velocity')
		stage.scrolling = false
		test.previous_x = foe.x
		test.previous_y = foe.y
		test.previous_velocity_y = foe.motion.velocity_y
		test.tracking_updates = 0
		test.phase = 'tracking_down'
		return false
	end

	if test.phase == 'tracking_down' then
		local foe<const> = mijter_foes[1]
		local dx<const> = foe.x - test.previous_x
		test.previous_x = foe.x
		test.previous_y = foe.y
		assert(dx == -3, 'MijterFoe lost the Sodom three-pixel horizontal step')
		assert(foe.motion.velocity_y
			== test.previous_velocity_y + mijter_foe_tracking_acceleration_y_q8,
			'MijterFoe no longer accelerates toward a lower player')
		test.previous_velocity_y = foe.motion.velocity_y
		assert(foe.sprite_component.imgid == assets_mijter_foe_red_down,
			'MijterFoe selected the wrong image while descending')
		test.tracking_updates = test.tracking_updates + 1
		if test.tracking_updates < 8 then
			return false
		end
		foe.target.y = foe.y - 32
		test.phase = 'tracking_up'
		return false
	end

	if test.phase == 'tracking_up' then
		local foe<const> = mijter_foes[1]
		local dx<const> = foe.x - test.previous_x
		test.previous_x = foe.x
		assert(dx == -3, 'MijterFoe horizontal step changed while steering')
		assert(foe.motion.velocity_y
			== test.previous_velocity_y - mijter_foe_tracking_acceleration_y_q8,
			'MijterFoe no longer accelerates toward a higher player')
		test.previous_velocity_y = foe.motion.velocity_y
		if foe.motion.velocity_y >= 0 then
			return false
		end
		assert(foe.sprite_component.imgid == assets_mijter_foe_red_up,
			'MijterFoe selected the wrong image while ascending')
		foe.x = -mijter_foe_width - 1
		test.phase = 'dispose'
		return false
	end

	return #mijter_foes == 0
end
