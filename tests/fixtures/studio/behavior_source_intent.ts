/** Source-only registrations; this program is never installed or executed by the browser workflow. */
export const BEHAVIOR_SOURCE_INTENT = `local trees = require('cartlib/behaviour_tree/library')
local machines = require('cartlib/fsm/library')
local effects = require('cartlib/actioneffects')
local shared<const> = { type = 'wait', duration_ticks = 2 }
trees.register('fixture.intent.tree', {
	root = {
		type = 'sequence',
		children = {
			shared,
			shared,
		},
	},
})
machines.register('fixture.intent.machine', {
	initial = 'idle',
	states = {
		idle = {
			update = function(owner)
				if owner.first then return '../active' end
				if owner.again then return '../active' end
			end,
		},
		active = {},
	},
})
effects.register_effect('fixture.intent.effect', {
	period_ms = 20,
	cooldown_ms = 50,
	handler = function(owner) return owner.result end,
})
return {}
`;
