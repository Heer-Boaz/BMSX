/** Source shared by structural, history and physical Studio tests; no game implementation dependency. */
const DECLARATIONS = `local leaf<const> = { type = 'wait', duration_ticks = 7 }
local inner<const> = { type = 'sequence', children = { leaf } }
local blueprint<const> = { root = { type = 'sequence', children = {
	-- traveller documentation
	leaf, -- traveller inline
	{ type = 'selector', children = { inner } },
	{ type = 'sequence', children = {} },
} } }
`;
export const BT_REPARENT_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')\n${DECLARATIONS}trees.register('fixture.reparent', blueprint)\n`;
export const BT_REPARENT_MODULE_SOURCE = `${DECLARATIONS}return blueprint\n`;
