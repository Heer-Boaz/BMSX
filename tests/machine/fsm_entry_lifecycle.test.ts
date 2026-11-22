import { test } from 'node:test';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { runGuestToHalt } from '../helpers/cpu_test_harness';

test('FSM entry constructs timeline targets before autoplay, including compound and concurrent entry', () => {
	const { cpu } = createCartlibProgramHarness(`
local events<const> = require('cartlib/event_emitter')
local library<const> = require('cartlib/fsm/library')
local fsm<const> = require('cartlib/fsm/fsm_component')
local timeline<const> = require('cartlib/timeline/timeline_component')
local target<const> = { id = 'entry_order', active = true }
function target:_retain_tag() end
function target:_release_tag() end
target.events = events.events_of(target)
local transport<const> = timeline.new(target,{clock_mode='manual'})
transport:on_attach()
local order<const> = {}
local record<const> = function(value) order[#order + 1] = value end
local animation<const> = {
	phase = 'presentation',
	frames = { 1, 2 }, frame_duration = 1, playback_mode = 'once',
	apply = function(self, value)
		self.visual.value = value
		record('sample')
	end,
}
library.register('entry_order', {
	initial = 'idle',
	states = {
		idle = {
			entering_state = function(self)
				self.visual = { value = 0 }
				record('entry')
			end,
			timelines = { idle = { def = animation } },
		},
		manual = {
			entering_state = function(self)
				self.visual = { value = 0 }
				self.timelines:play('manual')
			end,
			timelines = { manual = { def = animation, autoplay = false, on_finished = '/nested' } },
		},
		nested = {
			initial = 'child',
			entering_state = function(self)
				self.visual = { value = 0 }
				record('parent')
			end,
			timelines = { parent = { def = animation } },
			states = {
				child = {
					entering_state = function(self)
						assert(self.visual.value == 1, 'parent autoplay precedes child entry')
						record('child')
					end,
					timelines = { child = { def = animation } },
				},
				parallel = {
					is_concurrent = true,
					entering_state = function() record('parallel') end,
					timelines = { parallel = { def = animation } },
				},
			},
		},
	},
})
local machine<const> = fsm.factory({ 'entry_order' })(target)
machine:on_attach()
machine:_bind()
machine:start()
assert(order[1] == 'entry' and order[2] == 'sample', 'initial entry sampled an unconstructed target')
machine:transition_to('/manual')
assert(not transport:get('idle').playing, 'exit retained the previous timeline')
transport:tick_gameplay(2)
assert(machine:get_machine('entry_order').current_id == 'nested', 'manual play lost its state-owned completion binding')
local n<const> = #order
assert(order[n - 5] == 'parent' and order[n - 4] == 'sample'
	and order[n - 3] == 'child' and order[n - 2] == 'sample'
	and order[n - 1] == 'parallel' and order[n] == 'sample', 'nested entry order differs from initial entry')
machine:transition_to('/idle')
assert(order[#order - 1] == 'entry' and order[#order] == 'sample', 'reentry sampled the previous target')
assert(not transport:get('parent').playing and not transport:get('child').playing
	and not transport:get('parallel').playing, 'compound exit retained child playback')
`);
	runGuestToHalt(cpu, 10_000_000);
});

test('Empty definition lanes do not share live state and a rebind can add descendants', () => {
	const { cpu } = createCartlibProgramHarness(`
local fsm<const> = require('cartlib/fsm/fsm')
local events = 0
local handler<const> = function()
	events = events + 1
	return 'no_op'
end
local authored<const> = { ping = handler }
local blueprint<const> = { initial = 'idle', states = { idle = {}, awake = { on = authored } } }
local compiled<const> = fsm.state_definition.new('sparse', blueprint)
local second_definition<const> = fsm.state_definition.new('sparse', blueprint)
local left<const> = fsm.state.new(compiled, { id = 'left' })
local right<const> = fsm.state.new(second_definition, { id = 'right' })
left.states.idle.data.note = 12
assert(right.states.idle.data.note == nil and not left:dispatch_event('ping', nil, nil, 'left'))
local replacement<const> = fsm.state_definition.new('sparse', {
	initial = 'idle',
	states = { idle = { states = { child = { on = authored } } }, awake = { on = authored } },
})
fsm.assert_rebind_compatible(compiled, replacement)
left:rebind_definition(replacement)
assert(left.states.idle.data.note == 12 and left.states.idle.states.child ~= nil)
assert(right.states.idle.states.child == nil and authored.ping == handler)
fsm.transition_state_path(left, fsm.bind_state_path(replacement, '/awake'))
fsm.transition_state_path(left, fsm.bind_state_path(replacement, '/idle'))
left:dispatch_event('ping', nil, nil, 'left')
assert(events == 1, 'added child did not own its compiled handler')
left:reset()
assert(left.states.idle.data.note == nil and right.states.idle.data.note == nil)
`, { optLevel: 3 });
	runGuestToHalt(cpu, 10_000_000);
});
