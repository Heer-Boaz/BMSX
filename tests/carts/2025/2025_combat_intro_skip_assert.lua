require('globals')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = {
	frames = 0,
}

function __bmsx_host_test.ready()
	return world:get(director_instance_id) ~= nil and world:get(combat_director_instance_id) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = world:get(director_instance_id)
	local combat_director<const> = world:get(combat_director_instance_id)
	local test<const> = __bmsx_host_test
	test.combat_round = combat_director.state_machines:bind_state_path('/combat_round')
	test.combat_idle = combat_director.state_machines:bind_state_path('/idle')
	test.director_combat_wait = director.state_machines:bind_state_path('/combat_wait')
	director.node_id = 'combat_wekker'
	director.state_machines:transition_to('p3.director.fsm:/combat_wait')
	combat_director:start_combat('combat_wekker', true)
	return { down = 'KeyC' }
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local director<const> = world:get(director_instance_id)
	local combat_director<const> = world:get(combat_director_instance_id)
	test.frames = test.frames + 1
	assert(test.frames < 8, 'combat intro skip did not enter first round')

	if combat_director.state_machines:matches_state(test.combat_round) then
		assert(director.state_machines:matches_state(test.director_combat_wait), 'director left combat wait after intro skip')
		assert(director.node_id == 'combat_wekker', 'director changed story node during intro skip')
		return true
	end

	assert(not combat_director.state_machines:matches_state(test.combat_idle), 'intro skip ended combat instead of entering first round')
end
