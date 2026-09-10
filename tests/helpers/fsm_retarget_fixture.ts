/** Authored Lua: identical return text is not shared syntax; shared callbacks are. */
export const FSM_RETARGET_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local alias<const> = '../active'
local callback<const> = function(actor)
	if actor.first then return '../active', 'ignored result' end
	return ( --[[selected return]] '../active')
end
local branch<const> = {
	initial = 'idle',
	states = {
		idle = {
			update = callback,
			on = {
				direct = ( --[[direct path]] '../active'),
				wrapped = { emitter = false, go = ( --[[wrapped path]] '../active') },
				aliased = alias,
			},
		},
		active = {}, other = {},
	},
}
machines.register('fixture.one', { initial = 'left', states = { left = branch, right = branch, outside = {} } })
machines.register('fixture.two', { initial = 'left', states = { left = branch } })
`;

export const FSM_RETARGET_EXECUTION_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local choose<const> = function(owner)
	owner.calls = owner.calls + 1
	return ( --[[chosen path]] 'active')
end
machines.register('fixture.execution', {
	initial = 'idle', data = { retained = 73 },
	on = { choose = { emitter = false, go = choose } },
	states = {
		idle = { exiting_state = function(owner) owner.exits = owner.exits + 1 end },
		active = {},
		other = {
			transition_guards = { can_enter = function(owner)
				owner.guards = owner.guards + 1
				return owner.allowed
			end },
			entering_state = function(owner) owner.entries = owner.entries + 1 end,
		},
	},
})
`;

/** Explicit anchors and keys used by both source binding and real cartlib plan tests. */
export const FSM_RETARGET_PATH_SOURCE = String.raw`local machines<const> = require('cartlib/fsm/library')
local blueprint<const> = {
	initial = 'room',
	on = { relative = 'room/idle', absolute = '/room/idle' },
	states = {
		room = { initial = 'idle', on = { relative = 'idle', wide = '../room/idle', absolute = '/room/idle' }, states = {
			idle = { on = { sibling = '../active', wide = '../../room/active' } },
			active = {},
			lane = { is_concurrent = true, initial = 'idle', states = { idle = {}, active = {} } },
		} },
		idle = {}, _idle = {}, ['#idle'] = {}, _alias = {}, ['#hash'] = {}, no_op = {},
		['a/b'] = {}, ["quote'\\"] = {}, [''] = {}, ['.'] = {}, ['..'] = {},
	},
}
machines.register('fixture.paths', blueprint)
`;

export const FSM_RETARGET_PATH_CASES = [
	{ origin: [], event: 'relative', target: ['room', 'active'], text: 'room/active', absolute: false, up: 0, steps: [['room', false], ['active', false]] },
	{ origin: ['room'], event: 'relative', target: ['room', 'active'], text: 'active', absolute: false, up: 0, steps: [['active', false]] },
	{ origin: ['room'], event: 'relative', target: ['idle'], text: '../idle', absolute: false, up: 1, steps: [['idle', false]] },
	{ origin: ['room'], event: 'wide', target: ['room', 'active'], text: '../room/active', absolute: false, up: 1, steps: [['room', false], ['active', false]] },
	{ origin: ['room', 'idle'], event: 'wide', target: ['room', 'idle'], text: '../../room/idle', absolute: false, up: 2, steps: [['room', false], ['idle', false]] },
	{ origin: ['room', 'idle'], event: 'sibling', target: ['idle'], text: '../../idle', absolute: false, up: 2, steps: [['idle', false]] },
	{ origin: [], event: 'absolute', target: ['room', 'active'], text: '/room/active', absolute: true, up: 0, steps: [['room', false], ['active', false]] },
	{ origin: ['room'], event: 'absolute', target: ['room', 'active'], text: '/room/active', absolute: true, up: 0, steps: [['room', false], ['active', false]] },
	{ origin: ['room'], event: 'relative', target: [], text: '../', absolute: false, up: 1, steps: [] },
	{ origin: [], event: 'absolute', target: [], text: '/', absolute: true, up: 0, steps: [] },
	{ origin: [], event: 'relative', target: ['room', 'lane', 'active'], text: 'room/lane/active', absolute: false, up: 0, steps: [['room', false], ['lane', true], ['active', false]] },
	{ origin: [], event: 'relative', target: ['_idle'], text: '_idle', absolute: false, up: 0, steps: [['_idle', false]] },
	{ origin: [], event: 'relative', target: ['#idle'], text: '#idle', absolute: false, up: 0, steps: [['#idle', false]] },
	{ origin: [], event: 'relative', target: ['no_op'], text: "['no_op']", absolute: false, up: 0, steps: [['no_op', false]] },
	{ origin: [], event: 'relative', target: ['a/b'], text: "['a/b']", absolute: false, up: 0, steps: [['a/b', false]] },
	{ origin: [], event: 'relative', target: ["quote'\\"], text: String.raw`['quote\'\\']`, absolute: false, up: 0, steps: [["quote'\\", false]] },
] as const;

/** Ordinary entry source, installed by the product Save/Reboot flow. ICU drives real guest events. */
export const FSM_RETARGET_CART_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/event_emitter')
local machines<const> = require('cartlib/fsm/library')
local component<const> = require('cartlib/fsm/fsm_component')
local icu<const> = require('cartlib/input/icu')
display.reset_256x192()
clock.configure_tick_intervals(1, 1)
fsm_drag_init_count = 0
local function register_machines<init>()
	local choose<const> = function(owner)
		owner.calls = owner.calls + 1
		return ( --[[chosen path]] 'active')
	end
	local blueprint<const> = {
		initial = 'idle', data = { retained = 73 },
		on = { choose = { emitter = false, go = choose } },
		states = {
			idle = { exiting_state = function(owner) owner.exits = owner.exits + 1 end },
			active = {},
			other = {
				transition_guards = { can_enter = function(owner)
					owner.guards = owner.guards + 1
					return owner.allowed
				end },
				entering_state = function(owner) owner.entries = owner.entries + 1 end,
			},
		},
	}
	machines.register('fixture.drag.one', blueprint)
	machines.register('fixture.drag.two', blueprint)
	machines.register('fixture.drag.single', { initial = 'idle', on = { choose = 'active' }, states = { idle = {}, active = {}, other = {} } })
	fsm_drag_init_count = fsm_drag_init_count + 1
end
register_machines()
fsm_drag_target = { id = 'drag-target', active = true, tags = {}, allowed = false, calls = 0, guards = 0, exits = 0, entries = 0 }
function fsm_drag_target:_retain_tag(tag) self.tags[tag] = true end
function fsm_drag_target:_release_tag(tag) self.tags[tag] = nil end
fsm_drag_target.events = events.events_of(fsm_drag_target)
fsm_drag_component = component.factory({'fixture.drag.one', 'fixture.drag.two'})({ parent = fsm_drag_target })
fsm_drag_component.id = 'drag-target-fsm'
fsm_drag_component:on_attach()
registry:register(fsm_drag_component)
registry:index(fsm_drag_component, component)
fsm_drag_component:start()
fsm_drag_machine = fsm_drag_component:get_machine('fixture.drag.one')
fsm_drag_second = fsm_drag_component:get_machine('fixture.drag.two')
local control<const>: *word = icu.control_address
local keyboard<const>: *word = icu.keyboard_bitmap_address
local previous = false
while true do
	*control = icu.sample_next_vblank
	vblank.wait()
	local held<const> = (*keyboard & 0x08000000) ~= 0
	if (*keyboard & 0x20000000) ~= 0 then fsm_drag_target.allowed = true end
	if held and not previous then fsm_drag_target.events:emit('choose') end
	previous = held
end
`;
