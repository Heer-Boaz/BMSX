local registry<const> = require('cartlib/registry')
return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('controllers', function() return registry:get('p3.director') ~= nil and registry:get('p3.combat.director') ~= nil end, 120)
		local director<const> = registry:get('p3.director')
		local combat<const> = registry:get('p3.combat.director')
		director.session.node_id = 'combat_wekker'
		director.state_machines:transition_to('/combat_wait')
		combat:start_combat('combat_wekker', true)
	end,
	tests = {
		ready = function(t)
			assert(registry:get('p3.director').session.node_id == 'combat_wekker')
		end,
	},
}
