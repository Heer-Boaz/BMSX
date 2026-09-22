local registry<const> = require('cartlib/registry')
local director_id<const> = 'p3.director'
local combat_director_id<const> = 'p3.combat.director'
local monster_id<const> = 'p3.combat.monster'
return {
	kind = 'integration',
	tests = {
		skip_enters_first_round = function(t)
			t:wait_until('combat controllers', function() return registry:get(director_id) ~= nil and registry:get(combat_director_id) ~= nil end, 120)
			local director<const> = registry:get(director_id)
			local combat_director<const> = registry:get(combat_director_id)
			local test<const> = {}
			test.combat_round = combat_director.state_machines:bind_state_path('/combat_round')
			test.combat_idle = combat_director.state_machines:bind_state_path('/idle')
			test.director_combat_wait = director.state_machines:bind_state_path('/combat_wait')
			director.session.node_id = 'combat_wekker'
			director.state_machines:transition_to('p3.director.fsm:/combat_wait')
			combat_director:start_combat('combat_wekker', true)
			t:down('KeyC')
			t:wait_until('first round after skip', function()
				assert(not combat_director.state_machines:matches_state(test.combat_idle), 'intro skip ended combat')
				return combat_director.state_machines:matches_state(test.combat_round)
			end, 8)
			assert(director.state_machines:matches_state(test.director_combat_wait), 'director left combat wait after intro skip')
			assert(director.session.node_id == 'combat_wekker', 'director changed story node during intro skip')
			t:up('KeyC')
		end,
		monster_hidden_through_first_update = function(t)
			t:wait_until('combat controllers', function() return registry:get(director_id) ~= nil and registry:get(combat_director_id) ~= nil and registry:get(monster_id) ~= nil end, 120)
			local test<const> = {}
			local director<const> = registry:get(director_id)
			local combat_director<const> = registry:get(combat_director_id)
			director.session.node_id = 'combat_wekker'
			director.state_machines:transition_to('p3.director.fsm:/combat_wait')
			combat_director:start_combat('combat_wekker', true)
			local monster<const> = registry:get(monster_id)
			test.admission_visible = monster.visible
			test.admission_scale_x = monster.sprite_component.scale_x
			t:wait_ticks(1)


			assert(not test.admission_visible,
			'combat intro published monster before frame zero; scale=' .. tostring(test.admission_scale_x))
			assert(not monster.visible, 'combat intro first update published monster; scale=' .. tostring(monster.sprite_component.scale_x))

		end,
	},
}
