/** Ordinary cartridge source: real BT registration/rebind and ICU input, independent of game content. */
export const BT_REPARENT_LIVE_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local trees<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local result<const> = require('cartlib/behaviour_tree/result')
local icu<const> = require('cartlib/input/icu')
display.reset_256x192()
clock.configure_tick_intervals(1, 1)
local retained_key<const> = blackboard.key('retained', 0)
bt_live_init_count = 0
local function register_tree<init>()
	local first<const> = { type = 'task', task = { execute = function(owner)
		owner.order = owner.order * 10 + 1
		return result.success
	end } }
	local second<const> = { type = 'task', task = { execute = function(owner)
		owner.order = owner.order * 10 + 2
		return result.success
	end } }
	local third<const> = { type = 'task', task = { execute = function(owner)
		owner.order = owner.order * 10 + 3
		return result.success
	end } }
	local nested<const> = { type = 'sequence', children = { second } }
	trees.register('fixture.live', {
		blackboard = { retained_key },
		root = { type = 'sequence', children = { first, nested, third } },
	})
	bt_live_init_count = bt_live_init_count + 1
end
register_tree()
bt_live_target = { order = 0, executions = 0, retained = 0 }
bt_live_tree = component.factory('fixture.live')({ parent = bt_live_target })
bt_live_tree.id = 'fixture.live.tree'
registry:register(bt_live_tree)
registry:index(bt_live_tree, component)
bt_live_tree.blackboard:set(retained_key, 73)
local control<const>: *word = icu.control_address
local keyboard<const>: *word = icu.keyboard_bitmap_address
local previous = false
while true do
	*control = icu.sample_next_vblank
	vblank.wait()
	local held<const> = (*keyboard & 0x08000000) ~= 0
	if held and not previous then
		bt_live_target.order = 0
		bt_live_tree.evaluate(bt_live_target, bt_live_tree, bt_live_tree.operand)
		bt_live_target.executions = bt_live_target.executions + 1
		bt_live_target.retained = bt_live_tree.blackboard:get(retained_key)
	end
	previous = held
end
`;
