/** Ordinary Lua shared by the static lens and the real compiled cartlib oracle. */
export const BT_MEMBERSHIP_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
local result<const> = require('cartlib/behaviour_tree/result')
local leaf<const> = { type = 'task', task = { execute = function(owner)
	owner.order = owner.order * 10 + 1
	return result.success
end } }
local make_node<const> = function()
	return { type = 'task', task = { execute = function(owner)
		owner.order = owner.order * 10 + 2
		return result.success
	end } }, leaf
end
local make_children<const> = function() return { leaf } end
local make_choice<const> = function() return { weight = 3, child = leaf } end
local nested<const> = { type = 'sequence', children = make_children() }
local sequence_children<const> = { leaf, make_node(), nested, make_node() }
local sequence<const> = { type = 'sequence', children = sequence_children }
trees.register('fixture.membership', { root = sequence })
trees.register('fixture.shared-membership', { root = sequence })
trees.register('fixture.weighted-membership', { root = {
	type = 'weighted_random_selector', choices = {
		{ weight = 2, child = leaf }, make_choice(),
		{ weight = 4, child = make_node() }, { weight = 5, child = nested },
	},
} })
`;
