/** Source shared by structural, history and physical Studio tests; no game implementation dependency. */
export const BT_REPARENT_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 7 }
local inner<const> = { type = 'sequence', children = { leaf } }
trees.register('fixture.reparent', { root = { type = 'sequence', children = {
	-- traveller documentation
	leaf, -- traveller inline
	{ type = 'selector', children = { inner } },
	{ type = 'sequence', children = {} },
} } })
`;
