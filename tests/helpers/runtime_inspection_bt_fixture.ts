/** Normal module: compiled by the product, not a host-side model of BT execution. */
export const RUNTIME_INSPECTION_TREES_SOURCE = `local library<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local registry<const> = require('cartlib/registry')
local callbacks<const> = require('inspection_callbacks')
local trees<const> = {}
local count_key
inspection_bt_callback_count = 0
function trees.configure(revision)
	local count<const> = blackboard.key('count', revision * 10)
	count_key = count
	local vacant<const> = blackboard.key('vacant')
	local ready<const> = blackboard.key('ready', false)
	local callback<const> = blackboard.key('callback', callbacks.tree_tick)
	local keys
	if revision == 1 then keys = { count, vacant, ready, callback }
	else keys = { ready, count, callback, vacant } end
	local shared<const> = { type = 'task', task = { execute = callbacks.tree_start, tick = callbacks.tree_tick, node_memory = true } }
	library.register('rover', {
		blackboard = keys,
		root = { type = 'sequence', children = { shared, shared }, services = {
			{ service = { on_tick = callbacks.tree_service }, interval = { period_units = 2, units_per_tick = 1 } },
		} },
	})
	local bare_keys
	if revision > 1 then bare_keys = { blackboard.key('bound_later', revision) } end
	library.register('bare', { blackboard = bare_keys, root = { type = 'sequence', children = {
		{ type = 'task', task = { execute = callbacks.tree_execute } },
	} } })
	library.register('empty_board', { blackboard = {}, root = { type = 'sequence', children = {} } })
	library.register('unused', { root = { type = 'sequence', children = {} } })
end
local function attach(parent, id, tree_id)
	local instance<const> = component.new({ parent = parent }, tree_id)
	instance.id = id
	registry:register(instance)
	registry:index(instance, component)
	return instance
end
function trees.attach(first, second)
	inspection_bt_first = attach(first, 'inspection.bt.first', 'rover')
	inspection_bt_second = attach(second, 'inspection.bt.second', 'rover')
	inspection_bt_bare = attach(first, 'inspection.bt.bare', 'bare')
	inspection_bt_empty = attach(second, 'inspection.bt.empty', 'empty_board')
	inspection_bt_first.blackboard:set(count_key, 111)
	inspection_bt_second.blackboard:set(count_key, 222)
end
function trees.tick()
	inspection_bt_first.evaluate(inspection_bt_first.parent, inspection_bt_first, inspection_bt_first.operand)
	inspection_bt_second.evaluate(inspection_bt_second.parent, inspection_bt_second, inspection_bt_second.operand)
end
function trees.never_registered()
	library.register('rover', { root = { type = 'wait', duration_ticks = 999 } })
end
return trees
`;
