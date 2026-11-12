import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { runCompletionClosure } from './cpu_test_harness';

const trackEvaluator = readFileSync('cartlib/timeline/track_evaluator.lua', 'utf8').replace(
	'local compile_syntax<const> = lua_compiler.compile_syntax',
	`local original_compile_syntax<const> = lua_compiler.compile_syntax
local compile_syntax<const> = function(...)
 probe.compile_count = probe.compile_count + 1
 return original_compile_syntax(...)
end`,
);
const instrumentedModules = [{ path: 'cartlib/timeline/track_evaluator', source: trackEvaluator }];

for (const optLevel of [0, 3] as const) test(`timeline step appliers reuse matching code without retaining abandoned closures (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local apply<const> = require('cartlib/timeline/apply')
local refs<const> = setmetatable({}, {__mode='v'})
probe = {refs=refs}
function probe.exercise()
 local first<const> = apply.compile_step_apply({'first','x'},nil,1,nil,1)
 local same<const> = apply.compile_step_apply({'second','x'},nil,2,nil,1)
 local leaf<const> = apply.compile_step_apply({'first','y'},nil,1,nil,1)
 local receiver<const> = apply.compile_step_apply({'first','x'},nil,1,nil,2)
 assert(first==same and first~=leaf and first~=receiver)
 local a<const>, b<const> = {}, {}
 local entry<const> = {output_receivers={a,b},primary_binding=a,bindings={a,b},channel_writers={
  function(target,value) target.written=value end,
  function(target,value) target.other=value end,
 }}
 first(entry,11); leaf(entry,22); receiver(entry,33)
 assert(a.x==11 and a.y==22 and b.x==33)
 local writer<const> = apply.compile_step_apply({'x'},nil,1,1,1)
 local same_writer<const> = apply.compile_step_apply({'y'},nil,1,1,2)
 local other_binding<const> = apply.compile_step_apply({'x'},nil,2,1,1)
 local other_writer<const> = apply.compile_step_apply({'x'},nil,1,2,1)
 assert(writer==same_writer and writer~=other_binding and writer~=other_writer)
 writer(entry,44); other_binding(entry,55); other_writer(entry,66)
 assert(a.written==44 and b.written==55 and a.other==66)
 refs[1]=first; refs[2]=writer
end
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('exercise')!) as Closure, []);
	const refs = probe.getStringKey(cpu.stringPool.find('refs')!) as Table;
	assert.notEqual(refs.getInteger(1), null);
	assert.notEqual(refs.getInteger(2), null);
	cpu.collectTrackedHeapBytes();
	assert.equal(refs.getInteger(1), null, 'the cache must not retain unused appliers');
	assert.equal(refs.getInteger(2), null, 'the cache must not retain unused writers');
});

for (const optLevel of [0, 3] as const) test(`timeline value factories reuse only equivalent track capabilities (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
probe={compile_count=0}
local component<const> = require('cartlib/timeline/timeline_component')
local target<const> = {x=0,y=0}
local timelines<const> = component.new(target,{clock_mode='manual'})
local function linear(path,last)
 return {duration_ms=100,tracks={{kind='value',path={path},interpolation='linear',
  keys={{time_ms=0,value=0},{time_ms=100,value=last}}}}}
end
timelines:define('x',linear('x',10))
local after_first<const> = probe.compile_count
assert(after_first==1)
timelines:define('y',linear('y',30))
assert(probe.compile_count==after_first,'equivalent capabilities recompiled the value factory')
timelines:seek_time('x',50); timelines:seek_time('y',50)
assert(target.x==5 and target.y==15,'shared code retained another program')
`, { optLevel, modules: instrumentedModules });
	assert.equal(cpu.runUntilDepth(0, 25_000_000), RunResult.Halted);
});

for (const optLevel of [0, 3] as const) test(`sample callbacks remain local to their compiled timeline (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
probe={compile_count=0}
local component<const> = require('cartlib/timeline/timeline_component')
local timelines<const> = component.new({}, {clock_mode='manual'})
local calls = 0
local function sampled(value)
 return {phase='presentation',duration_ms=100,tracks={{kind='sample',apply=function() calls=calls+value end}}}
end
timelines:define('sample1',sampled(1))
local after_first<const> = probe.compile_count
assert(after_first==1)
timelines:define('sample2',sampled(10))
assert(probe.compile_count==after_first+1,'sample callbacks must not share a program-specific factory')
calls=0
timelines:seek_time('sample1',50); timelines:seek_time('sample2',50)
assert(calls==11,'sample callbacks retained the wrong program')
`, { optLevel, modules: instrumentedModules });
	assert.equal(cpu.runUntilDepth(0, 25_000_000), RunResult.Halted);
});

for (const optLevel of [0, 3] as const) test(`value-factory cache releases programs and separates step domains (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
probe={compile_count=0,refs=setmetatable({}, {__mode='v'})}
local evaluator<const> = require('cartlib/timeline/track_evaluator')
local scalar<const> = {track_count=0,linear_tracks={},cubic_tracks={},
 linear_time_tracks={},cubic_time_tracks={}}
local frame<const> = {scalar_program=scalar,has_frame_steps=true,has_time_steps=false,
 step_has_evaluation_callbacks=false,has_evaluation_callbacks=false,sample_time_track_count=0,
 has_spatial_frame_channels=false,has_spatial_time_channels=false}
local time<const> = {scalar_program=scalar,has_frame_steps=false,has_time_steps=true,
 step_has_evaluation_callbacks=false,has_evaluation_callbacks=false,sample_time_track_count=0,
 has_spatial_frame_channels=false,has_spatial_time_channels=false}
function probe.seed()
 local a<const> = evaluator.compile_values(frame,{})
 local b<const> = evaluator.compile_values(frame,{})
 local c<const> = evaluator.compile_values(time,{})
 assert(probe.compile_count==2,'equal shapes should share and different domains should not')
 probe.refs[1]=a; probe.refs[2]=b; probe.refs[3]=c
end
function probe.recreate()
 local a<const> = evaluator.compile_values(frame,{})
 probe.refs[1]=a
end
`, { optLevel, modules: instrumentedModules });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
	const refs = probe.getStringKey(cpu.stringPool.find('refs')!) as Table;
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('seed')!) as Closure, []);
	cpu.collectTrackedHeapBytes();
	for (let index = 1; index <= 3; index++) assert.equal(refs.getInteger(index), null);
	runCompletionClosure(cpu, probe.getStringKey(cpu.stringPool.find('recreate')!) as Closure, []);
	assert.equal(probe.getStringKey(cpu.stringPool.find('compile_count')!), 3,
		'an abandoned generated factory must be collected, then compiled on demand');
});
