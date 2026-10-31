import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`Timeline definition captures primary and nested named receivers before direct seek (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local component<const> = require('cartlib/timeline/timeline_component')
local primary<const> = {value=-1}
local secondary<const> = {value=-2}
local replacement_primary<const> = {value=-3}
local replacement_secondary<const> = {value=-4}
local owner<const> = {}
local timelines<const> = component.new(owner,{clock_mode='manual'})
local definition<const> = {duration_ms=100,bindings={'other'},tracks={{
 kind='value',path={'value'},interpolation='linear',
 keys={{time_ms=0,value=0},{time_ms=100,value=20}},
}},subsequences={{duration_ms=100,sequence={duration_ms=100,bindings={'other'},tracks={{
 kind='value',binding='other',path={'value'},interpolation='linear',
 keys={{time_ms=0,value=10},{time_ms=100,value=30}},
}}}}}}
local defaults<const> = {target=primary,other=secondary}
local entry<const> = timelines:define('sample',definition,defaults)
local child<const> = entry.sequence_state.entries[1]
defaults.target=replacement_primary
defaults.other=replacement_secondary
timelines:seek_time('sample',50)
assert(primary.value==10 and secondary.value==20
 and replacement_primary.value==-3 and replacement_secondary.value==-4,
 'definition did not capture exact primary and recursive named receivers')
timelines:play('sample',{bindings={target=replacement_primary,other=replacement_secondary}})
timelines:seek_time('sample',50)
assert(replacement_primary.value==10 and replacement_secondary.value==20,
 'explicit primary and named playback overrides were not admitted')
timelines:play('sample')
assert(primary.value==0 and secondary.value==10
 and entry.sequence_state.entries[1]==child,
 'play override changed defaults or rebuilt retained child transport')
local other_owner<const> = {value=91}
local other<const> = component.new(other_owner,{clock_mode='manual'})
local shared<const> = other:define('sample',definition,{other=replacement_secondary})
assert(shared.program==entry.program and shared.primary_binding==other_owner
 and shared.program.default_binding==nil,
 'runtime defaults leaked into the shared immutable program')
return true
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 15_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	});

	test(`Timeline registration retains transport before recipients and builds nested outputs at play (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local component<const> = require('cartlib/timeline/timeline_component')
local owner<const> = {}
local timelines<const> = component.new(owner,{clock_mode='manual'})
local definition<const> = {frames={7,8},frame_duration=50,duration_ms=100,subsequences={{
 duration_ms=100,sequence={frames={1,2},frame_duration=50,tracks={{
  kind='value',path={'panel','value'},interpolation='linear',
  keys={{time_ms=0,value=2},{time_ms=100,value=12}},
 }}},
}}}
local entry<const> = timelines:register('sample',definition)
entry:set_frame(1)
assert(entry:value()==8 and owner.panel==nil,
 'registration required recipients before constructor transport queries')
owner.panel={value=0}
timelines:play('sample')
timelines:seek_time('sample',50)
local retired<const> = owner.panel
assert(retired.value==7,'nested playback did not admit its newly created recipient')
timelines:stop('sample')
owner.panel=nil
local replacement<const> = {duration_ms=100,subsequences={{duration_ms=100,sequence={duration_ms=100,tracks={{
 kind='value',path={'panel','value'},interpolation='linear',
 keys={{time_ms=0,value=3},{time_ms=100,value=13}},
}}}}}}
assert(timelines:register('sample',replacement)==entry and owner.panel==nil,
 'stopped program replacement re-admitted an exited recipient lifetime')
owner.panel={value=0}
timelines:play('sample')
timelines:seek_time('sample',50)
assert(owner.panel.value==8 and retired.value==7,
 'replacement playback wrote the exited recipient')
local dynamic<const> = timelines:define('dynamic',{duration_ms=100,subsequences={{duration_ms=100,sequence={
 frames=function(params) return {{panel={value=params.value}},{panel={value=params.value+1}}} end,
 frame_duration=50,apply=true,subsequences={{duration_ms=100,sequence={duration_ms=100,tracks={{
  kind='value',path={'panel','other'},interpolation='linear',
  keys={{time_ms=0,value=10},{time_ms=100,value=30}},
 }}}}},
}}}})
timelines:play('dynamic',{params={value=41}})
assert(owner.panel.value==41 and owner.panel.other==10,
 'parameterized child construction failed to admit its static descendant')
return true
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	});
}
