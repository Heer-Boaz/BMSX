// Behavioral/runtime fixtures admit their actors through ordinary World
// construction, rather than publishing synthetic inspector memberships.
export const WORLD_ACTOR_FIXTURE = `
local fixture_world<const> = require('cartlib/world/world')
local fixture_prefab<const> = require('cartlib/world/prefab')
fixture_world:_add_space('fixture')
fixture_world:set_space('fixture')
local fixture_spawn<const> = function(definition_id, options, factories)
	fixture_prefab.define({ def_id = definition_id, components = factories })
	return fixture_world:spawn(definition_id, options)
end
`;
