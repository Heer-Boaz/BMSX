/** Authored test source shared by model tests and the real Studio workflow. No game-specific rows. */
export const BEHAVIOR_SOURCE_FIXTURE = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 2 }
local shared<const> = {
	type = 'sequence',
	children = { leaf, { type = 'wait', duration_ticks = 3 } },
}
local blueprint<const> = {
	blackboard = { seen = 0 },
	root = {
		type = 'sequence',
		services = { { service = services.scan, interval = { period_units = 2, units_per_tick = 1 } } },
		decorators = { { type = 'loop', num_loops = 2 } },
		children = {
			shared,
			shared,
			{ type = 'weighted_random_selector', choices = {
				{ weight = 2, child = leaf },
				{ weight = weights.retreat, child = shared },
			} },
		},
	},
}
trees.register('fixture.tree', blueprint)
trees.register('fixture.tree', {
	root = { type = 'simple_parallel', main_task = leaf, background_tree = shared },
})
`;
