/** Authored through Save/Reboot. Actual cartlib registration, component and rebind code execute. */
export const RUNTIME_INSPECTION_CART_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local effects<const> = require('cartlib/actioneffects')
local component<const> = require('cartlib/actioneffects/actioneffect_component')
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local world_object<const> = require('cartlib/world/world_object')
local input<const> = require('cartlib/input/input')
local callbacks<const> = require('inspection_callbacks')
local trees<const> = require('inspection_trees')
display.reset_256x192()
clock.configure_tick_intervals(1, 1)
input.add_player(1)
inspection_init_count = 0
inspection_callback_count = 0
inspection_fsm_callback_count = 0
inspection_tick = 0
local function configure<init>()
	inspection_init_count = inspection_init_count + 1
	effects.register_effect('pulse', {
		period_ms = (inspection_init_count + 1) * 10,
		initial_cooldown_ms = 7,
		handler = function() inspection_callback_count = inspection_callback_count + 1 end,
	})
	fsm_library.register('walker', {
		initial = 'nest',
		data = { revision = inspection_init_count * 10 },
		states = {
			nest = {
				initial = 'wait',
				data = { revision = inspection_init_count * 10 },
				update = callbacks.update,
				on = { advance = '/parked', redirect = callbacks.redirect },
				input_event_handlers = { { pattern = 'a[jp]', go = callbacks.redirect } },
				states = {
					wait = {},
					move = {},
					listener = { is_concurrent = true, initial = 'listening', states = { listening = {} } },
				},
			},
			parked = {},
		},
	})
	fsm_library.register('companion', { states = { resting = {} } })
	trees.configure(inspection_init_count)
end
configure()
local ungranted<const> = { period_ms = 777, handler = callbacks.update }
effects.register_effect('ungranted', ungranted)
effects.register_effect('shared_alias', ungranted)
effects.register_effect('empty', {})
fsm_library.register('unattached', { states = { hidden = {} } })
fsm_library.register('empty', { states = {} })
inspection_first = component.new({ parent = { id = 'first_actor', world = { gameplay_time_ms = 100 } } })
inspection_first.id = 'inspection.first'
registry:register(inspection_first)
registry:index(inspection_first, component)
inspection_first:grant_effect('pulse')
inspection_first:activate('pulse')
inspection_second = component.new({ parent = { id = 'second_actor', world = { gameplay_time_ms = 200 } } })
inspection_second.id = 'inspection.second'
registry:register(inspection_second)
registry:index(inspection_second, component)
inspection_second:grant_effect('pulse')
inspection_effect = inspection_first.effects.pulse
inspection_other = inspection_second.effects.pulse
for _, effect_component in ipairs({ inspection_first, inspection_second }) do
	local parent<const> = effect_component.parent
	setmetatable(parent, world_object)
	world_object.initialize(parent)
	parent.active = true
	parent.player_index = 1
end
inspection_fsm_first = fsm_component.new({ parent = inspection_first.parent }, { 'walker' })
inspection_fsm_first.id = 'inspection.fsm.first'
registry:register(inspection_fsm_first)
registry:index(inspection_fsm_first, fsm_component)
inspection_fsm_first:start()
inspection_fsm_first:get_machine('walker'):transition_to('/parked')
inspection_fsm_first:get_machine('walker').states.nest.data.revision = 111
inspection_fsm_second = fsm_component.new({ parent = inspection_second.parent }, { 'walker', 'companion' })
inspection_fsm_second.id = 'inspection.fsm.second'
registry:register(inspection_fsm_second)
registry:index(inspection_fsm_second, fsm_component)
inspection_fsm_second:start()
inspection_fsm_second:get_machine('walker').states.nest.data.revision = 222
trees.attach(inspection_first.parent, inspection_second.parent)
inspection_fsm_ready = true

-- Written registration candidates are not a loaded-definition catalog.
function inspection_never_registered()
	effects.register_effect('pulse', { period_ms = 999 })
	fsm_library.register('walker', { data = { revision = 999 }, states = { not_loaded = {} } })
end
-- A source inspection reads paths, never runs this function or its callbacks.
function inspection_values()
	return inspection_effect.definition.period_ms,
		inspection_effect.cooldown_until_ms,
		inspection_effect.active_count,
		inspection_other.definition.period_ms,
		inspection_other.cooldown_until_ms,
		inspection_tick
end
while true do
	inspection_tick = inspection_tick + 1
	trees.tick()
	vblank.wait()
end
`;

/** A second real module; navigation must not reuse the source registration's cart.lua coordinates. */
export const RUNTIME_INSPECTION_CALLBACKS_SOURCE = `local callbacks<const> = {}
function callbacks.update()
	inspection_fsm_callback_count = inspection_fsm_callback_count + 1
end
function callbacks.redirect()
	inspection_fsm_callback_count = inspection_fsm_callback_count + 1
	return '/parked'
end
local result<const> = require('cartlib/behaviour_tree/result')
function callbacks.tree_start(_target, memory)
	inspection_bt_callback_count = inspection_bt_callback_count + 1
	memory.ticks = 0
	return result.running
end
function callbacks.tree_tick(_target, memory)
	inspection_bt_callback_count = inspection_bt_callback_count + 1
	memory.ticks = memory.ticks + 1
	return result.running
end
function callbacks.tree_service()
	inspection_bt_callback_count = inspection_bt_callback_count + 1
end
function callbacks.tree_execute()
	inspection_bt_callback_count = inspection_bt_callback_count + 1
	return result.success
end
return callbacks
`;
