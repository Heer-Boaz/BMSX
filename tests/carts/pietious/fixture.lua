local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

local fixture<const> = {}

function fixture.start_game(t)
	t:wait_until('director admission', function() return registry:get('d') ~= nil end, 120)
	t:at_boundary(world:request_mutation_boundary(), 120)
	local outgoing<const> = registry:get('d')
	outgoing.request_new_game()
	t:wait_until('new game admission', function()
		local director<const> = registry:get('d')
		local castle<const> = registry:get('c')
		return director ~= nil and director ~= outgoing and castle ~= nil
			and castle.room ~= nil and world.active_space_id == 'main'
			and registry:get('pietolon') ~= nil
	end, 240)
	t:at_boundary(world:request_mutation_boundary(), 120)
	return registry:get('d'), registry:get('c'), registry:get('pietolon')
end

return fixture
