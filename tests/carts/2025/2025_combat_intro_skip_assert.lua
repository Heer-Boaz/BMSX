require('globals')

__bmsx_host_test = {
	frames = 0,
}

function __bmsx_host_test.ready()
	return oget(director_instance_id) ~= nil and oget(combat_director_instance_id) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = oget(director_instance_id)
	local combat_director<const> = oget(combat_director_instance_id)
	director.node_id = 'combat_wekker'
	director.sc:switch_state('p3.director.fsm', '/combat_wait')
	combat_director:start_combat('combat_wekker', true)
	return { down = 'KeyC' }
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local director<const> = oget(director_instance_id)
	local combat_director<const> = oget(combat_director_instance_id)
	test.frames = test.frames + 1
	assert(test.frames < 8, 'combat intro skip did not enter first round')

	if combat_director.sc:matches_state_path('/combat_round') then
		assert(director.sc:matches_state_path('/combat_wait'), 'director left combat wait after intro skip')
		assert(director.node_id == 'combat_wekker', 'director changed story node during intro skip')
		return true
	end

	assert(not combat_director.sc:matches_state_path('/idle'), 'intro skip ended combat instead of entering first round')
end
