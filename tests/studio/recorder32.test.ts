import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
import { ALL_EXECUTION_DOMAINS_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { IO_SYS_TIME_MS } from '../../machine/ts/spec/bmsx/io';
import { FsmTransitionObservation } from '../../ide/testing/observations/fsm_transition';
import { ActionEffectObservation } from '../../ide/testing/observations/actioneffect';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { RECORDER32_BOOT_SOURCE, RECORDER32_INITIALIZE, RECORDER32_MODULES, RECORDER32_ROM_SOURCE } from '../helpers/recorder32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

const sources = RECORDER32_MODULES.map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') }));
sources.push({ path: 'test/boot', source: RECORDER32_BOOT_SOURCE });
const modules = sources.map(m => ({...m, chunk:parseLuaChunk(m.source,m.path)}));
const initialize = "require('test/boot')\n" + RECORDER32_INITIALIZE;

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`recorder32 O${optLevel} ${backend}: actual Lua producers, sign/full wrap, raw timestamps and overflow policy`, t => {
		const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(initialize), modules,
			{entrySource:initialize,optLevel,programDomain:'system',traceStatements:'erase'}));
		const {cpu} = createTestSystemCpu(image, backend);
		assert.equal(cpu.runUntilDepth(0,1_000_000),RunResult.Halted);
		const roots = v.valuePayload(materializeCpuCompletionValues(cpu)[0]);
		const fsm = v.valuePayload(cpu.gc.tables.getInteger(roots, 1)), effects = v.valuePayload(cpu.gc.tables.getInteger(roots, 2));
		const fsmRecord = v.asClosure(cpu.gc.tables.getInteger(roots, 6),cpu.gc), effectRecord = v.asClosure(cpu.gc.tables.getInteger(roots, 7),cpu.gc);
		for (const start of [0x7ffffffd,0xfffffffd]) {
			for (const channel of [fsm,effects]) cpu.gc.tables.setInteger(channel, 4,v.valueInteger(start));
			const transitions: unknown[][] = [], facts: unknown[][] = [];
			const observation = new FsmTransitionObservation(fsm,cpu.stringPool,cpu.gc,(...args)=>transitions.push(args));
			const effect = new ActionEffectObservation(effects,cpu.stringPool,cpu.gc,{
				trigger:(...args)=>facts.push(args),activity:(...args)=>facts.push(args),
			});
			observation.discardPublished(); effect.discardPublished();
			const produce = (index: number) => {
				cpu.memory.writeIoU32(IO_SYS_TIME_MS,(0xfffffffc+index)>>>0);
				runCompletionClosure(cpu,fsmRecord,[cpu.gc.tables.getInteger(roots, 1),cpu.gc.tables.getInteger(roots, 3),cpu.gc.tables.getInteger(roots, 4),cpu.gc.tables.getInteger(roots, 5),v.valueBool(index%2===0)]);
				runCompletionClosure(cpu,effectRecord,[cpu.gc.tables.getInteger(roots, 2),v.valueString(cpu.stringPool.intern(index%2===0?'trigger':'activate')),
					v.valueString(cpu.stringPool.intern('fire')),index%2===0?v.valueString(cpu.stringPool.intern('accepted')):v.valueInteger(index)]);
			};
			for(let index=1;index<=8;index++) { produce(index); if(index%4===0) {observation.drain(20);effect.drain(20);} }
			assert.equal(transitions.length,8);assert.equal(facts.length,8);
			for(let index=1;index<=8;index++) {
				assert.deepEqual(transitions[index-1],[(start+index)>>>0,(0xfffffffc+index)>>>0,20,'lane','before','after',index%2===0?'committed':'rejected']);
				assert.deepEqual(facts[index-1],[(start+index)>>>0,(0xfffffffc+index)>>>0,20,'fire',index%2===0?'accepted':'activate',...(index%2===0?[]:[index])]);
			}
			observation.drain(21);effect.drain(21);assert.equal(transitions.length,8);assert.equal(facts.length,8);
			const retained: number[] = [], retainedEffects: number[] = [];
			const rollingEffect = new ActionEffectObservation(effects,cpu.stringPool,cpu.gc,{trigger:sequence=>retainedEffects.push(sequence),activity:sequence=>retainedEffects.push(sequence)},'rolling');
			rollingEffect.discardPublished();
			const rolling = new FsmTransitionObservation(fsm,cpu.stringPool,cpu.gc,sequence=>retained.push(sequence),'rolling'); rolling.discardPublished();
			for(let index=9;index<=14;index++) produce(index);
			assert.throws(()=>observation.drain(22),/overflowed its 4-record buffer/);
			assert.throws(()=>effect.drain(22),/overflowed its 4-record buffer/);
			rolling.drain(22);assert.equal(rolling.droppedCount,2);
			rollingEffect.drain(22);assert.equal(rollingEffect.droppedCount,2);
			assert.deepEqual(retainedEffects,[11,12,13,14].map(index=>(start+index)>>>0));
			assert.deepEqual(retained,[11,12,13,14].map(index=>(start+index)>>>0));
			for (const kind of ['fsm', 'effect'] as const) {
				const channel = kind === 'fsm' ? fsm : effects;
				const closure = kind === 'fsm' ? fsmRecord : effectRecord;
				const args = kind === 'fsm'
					? [cpu.gc.tables.getInteger(roots, 1), cpu.gc.tables.getInteger(roots, 3), cpu.gc.tables.getInteger(roots, 4), cpu.gc.tables.getInteger(roots, 5), v.valueBool(true)]
					: [cpu.gc.tables.getInteger(roots, 2), v.valueString(cpu.stringPool.intern('activate')), v.valueString(cpu.stringPool.intern('fire')), v.valueInteger(1)];
				const accepted: number[] = [];
				const strict = kind === 'fsm'
					? new FsmTransitionObservation(channel, cpu.stringPool, cpu.gc, () => assert.fail('overwritten data cannot be published'))
					: new ActionEffectObservation(channel, cpu.stringPool, cpu.gc, { trigger: () => assert.fail('overwritten data'), activity: () => assert.fail('overwritten data') });
				const rolling = kind === 'fsm'
					? new FsmTransitionObservation(channel, cpu.stringPool, cpu.gc, sequence => accepted.push(sequence), 'rolling')
					: new ActionEffectObservation(channel, cpu.stringPool, cpu.gc, { trigger: sequence => accepted.push(sequence), activity: sequence => accepted.push(sequence) }, 'rolling');
				strict.discardPublished(); rolling.discardPublished();
				for (let index = 0; index < 4; index++) runCompletionClosure(cpu, closure, args);
				const published = v.valuePayload(cpu.gc.tables.getInteger(channel, 4)), next = (published + 1) >>> 0;
				const overwritten = v.valuePayload(cpu.gc.tables.getInteger(v.valuePayload(cpu.gc.tables.getInteger(channel, 5)), ((next - 1) & 3) + 1));
				cpu.setExecutionHook(() => v.valuePayload(cpu.gc.tables.getInteger(overwritten, 1)) === next
					&& v.valuePayload(cpu.gc.tables.getInteger(channel, 4)) === published, ALL_EXECUTION_DOMAINS_MASK, ALL_EXECUTION_DOMAINS_MASK);
				cpu.beginCompletionCall(closure, args);
				assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped);
				assert.equal(v.valuePayload(cpu.gc.tables.getInteger(channel, 4)), published, 'the new record is not published yet');
				assert.throws(() => strict.drain(23), /overflowed its 4-record buffer/);
				rolling.drain(23);
				assert.equal(rolling.droppedCount, 1);
				assert.deepEqual(accepted, [published - 2, published - 1, published].map(word => word >>> 0));
				cpu.setExecutionHook(null, 0, 0);
				runGuestToHalt(cpu, 100_000);
				rolling.drain(24);
				assert.deepEqual(accepted, [published - 2, published - 1, published, next].map(word => word >>> 0));
			}

		}
		const fsmArgs = [cpu.gc.tables.getInteger(roots, 1), cpu.gc.tables.getInteger(roots, 3), cpu.gc.tables.getInteger(roots, 4), cpu.gc.tables.getInteger(roots, 5), v.valueBool(false)];
		const effectArgs = [cpu.gc.tables.getInteger(roots, 2), v.valueString(cpu.stringPool.intern('activate')), v.valueString(cpu.stringPool.intern('fire')), v.valueInteger(1)];
		runCompletionClosure(cpu, fsmRecord, fsmArgs); runCompletionClosure(cpu, effectRecord, effectArgs);
		const reserve = t.mock.method(cpu.luaHeap, 'admit');
		for (let index = 0; index < 32; index++) { runCompletionClosure(cpu, fsmRecord, fsmArgs); runCompletionClosure(cpu, effectRecord, effectArgs); }
		assert.equal(reserve.mock.callCount(), 0, 'preallocated recorder writes reserve no guest storage after warmup');
	});
}

for(const optLevel of [0,3] as const) test(`recorder32 O${optLevel}: physical ROM preserves producer words and cycle parity`,()=>{
	const image=linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(RECORDER32_ROM_SOURCE),modules,
		{entrySource:RECORDER32_ROM_SOURCE,optLevel,programDomain:'system',traceStatements:'erase'}));
	const {cpu}=createTestSystemCpu(image);const budget=2_000_000;
	assert.equal(cpu.runUntilDepth(0,budget),RunResult.Halted);
	const results=materializeCpuCompletionValues(cpu);
	assert.deepEqual(results,[v.valueBool(true),v.valueInteger(24),v.valueInteger(9),v.valueInteger(4),v.valueInteger(9),v.valueInteger(4)]);
	if(process.env.BMSX_CPU32_RUNNER) {
		const expected=[`budget ${cpu.instructionBudgetRemaining} fault 0`,...results.map(value=>`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n')+'\n';
		assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER,['--execute-rom',String(budget)],{input:image.romBytes,encoding:'utf8'}),expected);
	}
});
