import { WORLD_ACTOR_FIXTURE } from './world_actor_fixture';

/** Canonical authored Lua, independent of game definitions, paths and line numbers. */
const SHARED = `local shared<const> = {
	initial = ( --[[initial intent]] 'idle'),
	on = { reset = '/' },
	states = {
		idle = { on = { next = '../active' } },
		active = { on = { back = '../idle' } },
	},
}
`;
const REGISTRATIONS = `machines.register('fixture.initial', { initial = 'left', states = { left = shared, right = shared } })
machines.register('fixture.other', { initial = 'left', states = { left = shared } })
`;
const API = "require('cartlib/fsm/library')\n";
export const FSM_INITIAL_SOURCE = 'local machines<const> = ' + API + SHARED + REGISTRATIONS;
export const FSM_INITIAL_MODULE_SOURCE = SHARED + 'return shared\n';
export function fsmInitialImportedSource(modulePath: string): string {
	return 'local machines = ' + API + `local shared<const> = require('${modulePath}')\n` + REGISTRATIONS;
}

/** A small authored entry used through ordinary Save/Reboot and Hot Resume, not a synthetic ROM. */
export const FSM_INITIAL_CART_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
${WORLD_ACTOR_FIXTURE}
local machines = require('cartlib/fsm/library')
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
local make_fsm<const> = component.factory({ 'fixture.initial' })
fsm_initial_target = fixture_spawn('fsm_initial_target', { id = 'initial-target' }, {
	function(owner)
		local instance<const> = make_fsm(owner)
		instance.id = 'initial-target-fsm'
		return instance
	end,
})
fsm_initial_component = fsm_initial_target.state_machines
fixture_world:start()
fsm_initial_machine = fsm_initial_component:get_machine('fixture.initial')
while true do vblank.wait() end
`;
