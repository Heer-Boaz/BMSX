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
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 20, 'Nemesis S ray-lifecycle scenario timed out')

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'spawn' then
		stage.actor_spawn_index = stage.actor_spawn_count + 1

		local chimney<const> = world:spawn(ids_schoorsteen_foe_def, {
			stage = stage,
			pos = { x = 120, y = 88 },
		})
		local cooling_down<const> = chimney.state_machines:bind_state_path('/cooling_down')
		local idle<const> = chimney.state_machines:bind_state_path('/idle')
		chimney.state_machines:transition_to('/firing')
		chimney:fire_ray()
		local ray<const> = chimney.ray
		ray:finish()
		assert(chimney.ray == nil and chimney.state_machines:matches_state(cooling_down),
			'completed chimney ray did not return its live emitter to cooldown')

		chimney.state_machines:transition_to('/idle')
		ray.events:emit('enemy.ray.finished')
		assert(chimney.state_machines:matches_state(idle),
			'completed ray retained a stale completion subscription')

		local snowman<const> = world:spawn(ids_sneeuwpop_def, {
			stage = stage,
			pos = { x = 160, y = 48 },
		})
		snowman.state_machines:transition_to('/firing')
		snowman:fire_ray()
		local detached_ray<const> = snowman.ray
		snowman:on_destroyed()
		assert(registry:get(snowman.id) == nil,
			'destroyed snowman remained published')
		assert(registry:get(detached_ray.id) == detached_ray,
			'destroying a snowman erased its independently retained ray')

		detached_ray:finish()
		assert(registry:get(detached_ray.id) == nil,
			'detached snowman ray did not finish its own lifecycle')
		return true
	end

	return false
end
