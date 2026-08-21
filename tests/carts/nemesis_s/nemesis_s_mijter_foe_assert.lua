local registry<const> = require('cartlib/registry')
local prefab<const> = require('cartlib/world/prefab')
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
	local gameplay_time_ms<const> = world.gameplay_time_ms
	local mijter_foes<const> = test.mijter_foes.objects

	if test.phase == 'spawn' then
		if stage.tape_head - 1 < 56 or #mijter_foes == 0 then
			return false
		end
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 700, 'Nemesis S MijterFoe scenario timed out phase=' .. test.phase)
		assert(#mijter_foes == 1, 'MijterFoe marker did not spawn exactly one actor')
		local authored_spawn
		for index = 1, stage.actor_spawn_count do
			local spawn<const> = stage.actor_spawns[index]
			if spawn.definition_id == ids_mijter_foe_def
			and spawn.options.mijter_type == mijter_foe_type_red then
				authored_spawn = spawn
				break
			end
		end
		assert(authored_spawn.column == 56, 'MijterFoe missed its authored XNA stage column')
		assert(authored_spawn.options.pos.x == playfield_width,
			'MijterFoe no longer enters at the playfield edge')
		assert(authored_spawn.options.pos.y == 40, 'MijterFoe no longer uses the XNA row offset')
		local foe<const> = mijter_foes[1]
		assert(foe.mijter_type == mijter_foe_type_red, 'uppercase M did not produce the red MijterFoe')
		assert(prefab.definition(ids_mijter_foe_def).defaults.imgid == assets_mijter_foe_blue_neutral,
			'MijterFoe prefab started with the wrong image')
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
		local velocity_delta<const> = foe.motion.velocity_y - test.previous_velocity_y
		if dx == 0 or velocity_delta == 0 or foe.sprite_component.imgid ~= assets_mijter_foe_red_down then
			return false
		end
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 700, 'Nemesis S MijterFoe scenario timed out phase=' .. test.phase)
		test.previous_x = foe.x
		test.previous_y = foe.y
		assert(velocity_delta > 0
			and velocity_delta % mijter_foe_tracking_acceleration_y_q8 == 0,
			'MijterFoe no longer accelerates toward a lower player')
		local movement_steps<const> = velocity_delta // mijter_foe_tracking_acceleration_y_q8
		assert(dx == -3 * movement_steps, 'MijterFoe lost the Sodom three-pixel horizontal step')
		test.previous_velocity_y = foe.motion.velocity_y
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
		local velocity_delta<const> = test.previous_velocity_y - foe.motion.velocity_y
		if dx == 0 or velocity_delta == 0 or foe.motion.velocity_y >= 0
		or foe.sprite_component.imgid ~= assets_mijter_foe_red_up then
			return false
		end
		test.gameplay_time_ms = gameplay_time_ms
		test.frames = test.frames + 1
		assert(test.frames < 700, 'Nemesis S MijterFoe scenario timed out phase=' .. test.phase)
		test.previous_x = foe.x
		assert(velocity_delta % mijter_foe_tracking_acceleration_y_q8 == 0,
			'MijterFoe no longer accelerates toward a higher player')
		local movement_steps<const> = velocity_delta // mijter_foe_tracking_acceleration_y_q8
		assert(dx == -3 * movement_steps, 'MijterFoe horizontal step changed while steering')
		test.previous_velocity_y = foe.motion.velocity_y
		foe.x = -mijter_foe_width - 1
		test.phase = 'dispose'
		return false
	end

	test.gameplay_time_ms = gameplay_time_ms
	test.frames = test.frames + 1
	assert(test.frames < 700, 'Nemesis S MijterFoe scenario timed out phase=' .. test.phase)
	return #mijter_foes == 0
end
