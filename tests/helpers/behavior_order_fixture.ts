/** Canonical Lua for source moves, physical Studio controls and the compiled CPU oracle. */
export const BT_ORDER_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
local result<const> = require('cartlib/behaviour_tree/result')
local leaf<const> = { type = 'task', task = { execute = function(owner)
	owner.order = owner.order * 10 + 1
	return result.success
end } }
local make_node<const> = function(value)
	return { type = 'task', task = { execute = function(owner)
		owner.order = owner.order * 10 + value
		return result.success
	end } }
end
local nested<const> = { type = 'sequence', children = { leaf, make_node(2) } }
local children<const> = {
	-- first documentation
	leaf, -- first inline
	note = 'metadata is not a child',
	-- nested documentation 🐉
	nested; -- nested inline
	-- last documentation
	make_node(3) -- last inline
}
local root<const> = { type = 'sequence', children = children }
trees.register('fixture.order', { root = root })
trees.register('fixture.shared-order', { root = root })
local weighted<const> = { type = 'weighted_random_selector', choices = {
	{ weight = 1, child = leaf },
	note = 'metadata is not a choice',
	{ weight = 9, child = nested },
	{ weight = 3, child = make_node(3) }
} }
trees.register('fixture.weighted-order', { root = weighted })
`;
