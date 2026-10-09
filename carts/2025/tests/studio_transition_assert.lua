local registry<const> = require('cartlib/registry')
return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('director', function() return registry:get('p3.director') ~= nil end, 120)
		local director<const> = registry:get('p3.director')
		director.session.node_id = 'overgang_monday'
		director.state_machines:transition_to('/run_node')
	end,
	tests = {
		ready = function(t)
			assert(registry:get('p3.director').session.node_id == 'overgang_monday')
		end,
	},
}
