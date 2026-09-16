import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

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
local transport<const> = timeline.new({ parent = target })
transport:on_attach()
local order<const> = {}
local record<const> = function(value) order[#order + 1] = value end
local animation<const> = {
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
local machine<const> = fsm.factory({ 'entry_order' })({ parent = target })
machine:on_attach()
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
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
});
