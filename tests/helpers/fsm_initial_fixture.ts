/** Canonical authored Lua, independent of game definitions, paths and line numbers. */
export const FSM_INITIAL_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local shared<const> = {
	initial = ( --[[initial intent]] 'idle'),
	on = { reset = '/' },
	states = {
		idle = { on = { next = '../active' } },
		active = { on = { back = '../idle' } },
	},
}
machines.register('fixture.initial', { initial = 'left', states = { left = shared, right = shared } })
machines.register('fixture.other', { initial = 'left', states = { left = shared } })
`;

/** A small authored entry used through ordinary Save/Reboot and Hot Resume, not a synthetic ROM. */
export const FSM_INITIAL_CART_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/event_emitter')
local machines<const> = require('cartlib/fsm/library')
local component<const> = require('cartlib/fsm/fsm_component')
display.reset_256x192()
clock.configure_tick_intervals(1, 1)
fsm_initial_init_count = 0
local function register_machine<init>()
	machines.register('fixture.initial', {
		initial = ( --[[initial intent]] 'idle'),
		states = {
			idle = { data = { retained = 73 } },
			active = {},
		},
	})
	fsm_initial_init_count = fsm_initial_init_count + 1
end
register_machine()
fsm_initial_target = { id = 'initial-target', active = true, tags = {} }
function fsm_initial_target:_retain_tag(tag) self.tags[tag] = true end
function fsm_initial_target:_release_tag(tag) self.tags[tag] = nil end
fsm_initial_target.events = events.events_of(fsm_initial_target)
fsm_initial_component = component.factory({'fixture.initial'})({ parent = fsm_initial_target })
fsm_initial_component.id = 'initial-target-fsm'
fsm_initial_component:on_attach()
registry:register(fsm_initial_component)
registry:index(fsm_initial_component, component)
fsm_initial_component:start()
fsm_initial_machine = fsm_initial_component:get_machine('fixture.initial')
while true do vblank.wait() end
`;
