import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { executionDomainBit, SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import { CapturedLocalKind } from '../../toolchain/ts/lua/compiler/capture_kind';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { LuaCaptureLayout } from '../../toolchain/ts/lua/compiler/capture_layout';
import { LuaSourceCorrespondence } from '../../toolchain/ts/lua/semantic/source_correspondence';
import { linkSystemBlua32Image, type LinkedSystemBlua32Image } from '../../toolchain/ts/rompack/blua32_linker';
import { buildBlua32ExecutionRevision } from '../../toolchain/ts/rompack/blua32_revision';
import { SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createTestSystemCpu, linkTestSystemBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const PATH = 'retention.lua';
const ADDRESS = SYSTEM_ROM_BASE + 0x100;

function compile(source: string, baseline?: { source: string; linked: LinkedSystemBlua32Image }, optLevel: 0 | 3 = 3) {
	const correspondence = new LuaSourceCorrespondence(new Map(baseline ? [[PATH, baseline.source]] : []), new Map([[PATH, source]]));
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, PATH), [], {
		entrySource: source, programDomain: 'system', optLevel,
		captureLayout: baseline ? new LuaCaptureLayout(baseline.linked.symbols.metadata, correspondence) : undefined,
	});
	const linked = linkSystemBlua32Image(
		encodeCompiledProgramObject(compiled), compiled.metadata, ADDRESS, PSX_MACHINE_SPEC.ramBytes, [],
		baseline ? { image: baseline.linked.layout, symbols: baseline.linked.symbols, captureSources: correspondence } : undefined,
	);
	return { source, compiled, linked, correspondence };
}

function prove(previous: ReturnType<typeof compile>, fresh: ReturnType<typeof compile>) {
	return buildBlua32ExecutionRevision(previous.linked.layout, previous.linked.symbols,
		new Map([[PATH, previous.source]]), fresh.linked, new Map([[PATH, fresh.source]]), fresh.correspondence);
}

function names(revision: ReturnType<typeof compile>, suffix: string) {
	const metadata = revision.linked.symbols.metadata;
	const index = metadata.functionIds.findIndex(id => id.endsWith(suffix));
	assert.notEqual(index, -1, suffix);
	return metadata.upvalueBindingsByFunction[index].map(slot => metadata.capturedLocals[slot].name);
}

test('live capture prefixes survive removal, permutation, complete disuse and repeated undo', () => {
	const before = 'local first = 11\nlocal second = 22\nfunction read() return first, second end';
	let previous = compile(before);
	for (const body of ['second', 'second, first', '9', 'first, second', 'second']) {
		const fresh = compile(before.replace('return first, second', `return ${body}`), previous);
		assert.deepEqual(names(fresh, '/decl:read'), ['first', 'second']);
		assert.doesNotThrow(() => prove(previous, fresh));
		previous = fresh;
	}
	assert.deepEqual(names(compile(before.replace('return first, second', 'return second')), '/decl:read'), ['second']);
});

test('closed live cells and new closures both read correct values after creation registers shift', () => {
	const before = `local first = 11
local second = 22
local function read() return first, second end
local function make(value)
	local a = value
	local b = value + 1
	return function() return a, b end
end
return read, make, make(40)`;
	const after = before.replace('local first = 11', 'local extra = {}\nlocal first = 11')
		.replace('return first, second', 'return second, first').replace('return a, b', 'return b');
	const initial = compile(before);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(initial.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const [read, make, held] = materializeCpuCompletionValues(cpu) as Closure[];
	const fresh = compile(after, initial);
	prove(initial, fresh);
	const index = initial.linked.symbols.metadata.functionIds.findIndex(id => id.endsWith('/local:read'));
	assert.notDeepEqual(initial.linked.layout.functions[index].upvalues, fresh.linked.layout.functions[index].upvalues);
	memory.installSystemRom(writeTestBlua32Rom(fresh.linked));
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	for (const [closure, expected] of [[read, [22, 11]], [held, [41]]] as const) {
		cpu.beginCompletionCall(closure);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), expected);
	}
	cpu.beginCompletionCall(make, [60]);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const [created] = materializeCpuCompletionValues(cpu) as Closure[];
	cpu.beginCompletionCall(created);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [61]);
});

test('nested retained readers and writers keep aliasing the same cell', () => {
	const before = `local state = 3
local extra = 9
local function outer()
	local function read() return extra, state end
	local function write(value) state = value end
	return read, write
end
return outer()`;
	const initial = compile(before);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(initial.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const [read, write] = materializeCpuCompletionValues(cpu) as Closure[];
	const fresh = compile(before.replace('return extra, state', 'return state'), initial);
	prove(initial, fresh);
	assert.deepEqual(names(fresh, '/local:outer'), ['extra', 'state']);
	assert.deepEqual(names(fresh, '/local:read'), ['extra', 'state']);
	assert.deepEqual(names(fresh, '/local:write'), ['state']);
	memory.installSystemRom(writeTestBlua32Rom(fresh.linked));
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	cpu.beginCompletionCall(write, [42]);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.beginCompletionCall(read);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [42]);
});

test('receiver and parameter roles retain real bound locals after body edits', () => {
	const before = `local object = { value = 2 }
function object:make(value)
	return function() return self.value, value end
end
return object:make(7)`;
	const initial = compile(before);
	const fresh = compile('\n' + before.replace('return self.value, value', 'return value'), initial);
	assert.doesNotThrow(() => prove(initial, fresh));
	assert.deepEqual(fresh.compiled.metadata.capturedLocals.map(local => local.kind), [CapturedLocalKind.Receiver, CapturedLocalKind.Parameter]);
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(fresh.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.beginCompletionCall((materializeCpuCompletionValues(cpu) as Closure[])[0]);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [7]);
});

test('Hot Resume retains the shared implicit receiver cell used by a reader and a rebinding writer', () => {
	const before = `local object = { value = 2 }
function object:make()
	local function read() return self.value end
	local function write(value) self = { value = value } end
	return read, write
end
return object:make()`;
	const initial = compile(before);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(initial.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const [read, write] = materializeCpuCompletionValues(cpu) as Closure[];
	assert.deepEqual(names(initial, '/local:read'), ['self']);
	assert.deepEqual(names(initial, '/local:write'), ['self']);
	const receiver = initial.compiled.metadata.capturedLocals.find(local => local.name === 'self')!;
	assert.equal(receiver.kind, CapturedLocalKind.Receiver);
	cpu.beginCompletionCall(write, [40]);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const fresh = compile(before.replace('value = value }', 'value = value + 1 }'), initial);
	prove(initial, fresh);
	memory.installSystemRom(writeTestBlua32Rom(fresh.linked));
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	cpu.beginCompletionCall(read);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [40], 'the existing cell survives installation');
	cpu.beginCompletionCall(write, [50]);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	cpu.beginCompletionCall(read);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [51], 'the existing writer runs the new body on that same cell');
});

test('new live captures still reject instead of inventing missing cells', () => {
	const before = 'local first = 1\nlocal second = 2\nfunction read() return first end';
	const initial = compile(before);
	const fresh = compile(before.replace('return first', 'return first, second'), initial);
	assert.throws(() => prove(initial, fresh), /cannot change closure identity/);
});

test('removed or reparented defining locals reject before lowering', () => {
	const before = 'local state = 1\nfunction read() return state end';
	const initial = compile(before);
	assert.throws(() => compile('function read() return 4 end', initial), /cannot map captured declaration/);
	assert.throws(() => compile('do\n' + before + '\nend', initial), /cannot map captured declaration/);
});

test('unused retained capture initializers survive O3 for newly created closures', () => {
	const before = 'local first = 11\nlocal second = 22\nreturn function() return first, second end';
	const initial = compile(before);
	const fresh = compile(before.replace('return first, second', 'return second'), initial);
	prove(initial, fresh);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(fresh.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const closure = (materializeCpuCompletionValues(cpu) as Closure[])[0];
	assert.equal(closure.upvalues.length, 2);
	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [22]);
	const restored = compile(before, fresh);
	prove(fresh, restored);
	memory.installSystemRom(writeTestBlua32Rom(restored.linked));
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	cpu.beginCompletionCall(closure);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [11, 22]);
});

test('cold compiler does not reserve captures or alter anonymous ids', () => {
	const source = 'local value = 3\nreturn function() return value end';
	assert.deepEqual(compileLuaSource(source, PATH, 3).metadata.protoIds, compile(source).compiled.metadata.protoIds);
});

test('tombstone declarations follow source shifts and can revive without reinterpreting cells', () => {
	const before = 'local state = 3\nfunction read() return state end';
	const initial = compile(before);
	const removed = compile('local extra = {}\nlocal state = 3', initial);
	prove(initial, removed);
	assert.equal(removed.linked.symbols.metadata.capturedLocals[0].definition!.start.line, 2);
	const shifted = compile('\n' + removed.source, removed);
	prove(removed, shifted);
	assert.equal(shifted.linked.symbols.metadata.capturedLocals[0].definition!.start.line, 3);
	const revived = compile(shifted.source + '\nfunction read() return state + 1 end', shifted);
	assert.doesNotThrow(() => prove(shifted, revived));
});

test('a removed origin never aliases a later same-name local at its old source coordinates', () => {
	const initial = compile('local state = 3\nfunction read() return state end');
	const removed = compile('local other = 4', initial);
	prove(initial, removed);
	assert.equal(removed.linked.symbols.metadata.capturedLocals[0].definition, null);
	const replacement = compile('local state = 90', removed);
	prove(removed, replacement);
	assert.equal(replacement.linked.symbols.metadata.capturedLocals[0].definition, null);
	assert.throws(() => compile(replacement.source + '\nfunction read() return state end', replacement), /defining declaration was removed/);
});

test('anonymous identities use installed definitions through repeated shifts, not their original id coordinates', () => {
	const before = 'local state = 3\nreturn function() return state end';
	let previous = compile(before);
	const initialIds = previous.compiled.metadata.protoIds;
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(previous.compiled));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	const [held] = materializeCpuCompletionValues(cpu) as Closure[];
	for (let index = 1; index <= 4; index += 1) {
		const source = '\n'.repeat(index) + before.replace('return state', `return state + ${index}`);
		const fresh = compile(source, previous);
		assert.deepEqual(fresh.compiled.metadata.protoIds, initialIds);
		prove(previous, fresh);
		memory.installSystemRom(writeTestBlua32Rom(fresh.linked));
		cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
		cpu.beginCompletionCall(held);
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [3 + index]);
		previous = fresh;
	}
});

test('relocated paused frames retain open shared cells until their owner returns', () => {
	const before = `local state = 3
local extra = 9
local function read() return extra, state end
local function write(value) state = value end
local function checkpoint() return 0 end
checkpoint()
write(42)
return read()`;
	const initial = compile(before, undefined, 0);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(linkTestSystemBlua32(initial.compiled));
	const checkpointIndex = initial.linked.symbols.metadata.functionIds.findIndex(id => id.endsWith('/local:checkpoint'));
	const checkpointPc = initial.linked.layout.functions[checkpointIndex].codeAddress;
	cpu.setExecutionHook((_domain, pc) => pc === checkpointPc, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.ExecutionStopped);
	const fresh = compile(before.replace('return extra, state', 'return state'), initial, 0);
	const revision = prove(initial, fresh);
	const relocation = buildHotResumeRelocation(cpu, [{ previousImage: initial.linked.layout, freshImage: fresh.linked.layout, revision }, null, null], cpu.getFrameDepth());
	memory.installSystemRom(writeTestBlua32Rom(fresh.linked));
	cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	applyHotResumeRelocation(cpu, relocation);
	cpu.setExecutionHook(null, 0, 0);
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [42]);
});

test('new anonymous closures do not steal the reserved identity at an earlier source position', () => {
	const before = 'local state = 3\nlocal functions = {}\nfunctions[1] = function() return state end\nreturn functions';
	const initial = compile(before);
	const after = before.replace('functions[1]', 'functions[2] = function() return 90 end\nfunctions[1]');
	const fresh = compile(after, initial);
	prove(initial, fresh);
	const oldIndex = initial.compiled.metadata.protoIds.findIndex(id => id.includes('/anon:'));
	const id = initial.compiled.metadata.protoIds[oldIndex];
	const newIndex = fresh.compiled.metadata.protoIds.indexOf(id);
	assert.notEqual(newIndex, -1);
	assert.equal(fresh.compiled.metadata.functionDefinitionsByProto[newIndex]!.start.line, 4);
	assert.equal(new Set(fresh.compiled.metadata.protoIds).size, fresh.compiled.metadata.protoIds.length);
});

test('same anonymous source coordinates in different modules keep separate function owners', () => {
	const entrySource = "local first = require('first')\nlocal second = require('second')\nreturn first.make(7)(), second.make(8)()";
	const firstSource = 'local owner = {}\nfunction owner.make(state) return function() return state end end\nreturn owner';
	const secondSource = firstSource;
	const modules = [
		{ path: 'first', source: firstSource, chunk: parseLuaChunk(firstSource, 'first') },
		{ path: 'second', source: secondSource, chunk: parseLuaChunk(secondSource, 'second') },
	];
	const entry = parseLuaChunk(entrySource, 'entry');
	const initial = compileLuaChunkToProgram(entry, modules, { entrySource, programDomain: 'system', optLevel: 3 });
	const linked = linkTestSystemBlua32(initial);
	const sources = new Map([['entry', entrySource], ['first', firstSource], ['second', secondSource]]);
	const fresh = compileLuaChunkToProgram(entry, modules, {
		entrySource, programDomain: 'system', optLevel: 3,
		captureLayout: new LuaCaptureLayout(linked.symbols.metadata, new LuaSourceCorrespondence(sources, sources)),
	});
	assert.deepEqual(fresh.metadata.protoIds, initial.metadata.protoIds);
	const { cpu } = createTestSystemCpu(linkTestSystemBlua32(fresh));
	assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [7, 8]);
});
