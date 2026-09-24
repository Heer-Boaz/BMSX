/** Authored working copy for shared builder/conversation tests; never installed as a guest. */
export const BEHAVIOR_TOOLS_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local trees<const> = require('cartlib/behaviour_tree/library')
local effects<const> = require('cartlib/actioneffects')
machines.register('fixture.tools.machine', {
	initial = 'idle', -- source intent stays here
	states = { idle = { on = { go = '../active' } }, active = {} },
})
trees.register('fixture.tools.tree', { root = { type = 'sequence', children = {
	{ type = 'task', task = { execute = function() return 1 end } },
	{ type = 'wait', duration_ms = 20 },
} } })
effects.register_effect('fixture.tools.effect', { cooldown_ms = 10, required_tags = { 'live' } })
`;
