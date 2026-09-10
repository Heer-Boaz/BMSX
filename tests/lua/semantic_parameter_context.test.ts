import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

test('written formal bindings have a location per call, distinct from the input value', () => {
	const file = buildLuaFileSemanticData([
		'local original<const> = { original = true }',
		'local replacement<const> = { replacement = true }',
		'local function change(value) value = replacement return value end',
		'change(original)',
		'change(original)',
	].join('\n'), 'parameters.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const query = new SemanticInstantiationQuery(summaries, demand, () => {});
	const summary = summaries.list()[0];
	const argument = summaries.terms.compileSource(file.callValues[0].arguments[0]!);
	const first = query.instantiate(file.callValues[0], summary.id, 0, 0, [argument], undefined);
	const second = query.instantiate(file.callValues[1], summary.id, 0, 0, [argument], undefined);
	const binding = summaries.terms.compileSource(summary.source.parameters[0]);
	assert.equal(summaries.terms.kind(binding), TermKind.Local);
	assert.equal(summaries.terms.kind(summary.parameters[0]), TermKind.Parameter);
	assert.equal(query.contextualize(summary.parameters[0], first), argument, 'only the immutable entry value substitutes the actual');
	const firstBinding = query.contextualize(binding, first);
	const secondBinding = query.contextualize(binding, second);
	assert.equal(summaries.terms.kind(firstBinding), TermKind.ContextRoot);
	assert.equal(summaries.terms.base(firstBinding), binding);
	assert.equal(summaries.terms.operand(firstBinding), first);
	assert.notEqual(firstBinding, argument);
	assert.notEqual(firstBinding, secondBinding);
	assert.equal(query.values.first(argument), 0, 'assigning the formal does not assign the actual');
	assert.equal(query.values.target(query.values.first(firstBinding)), argument, 'entry value flows from actual to formal');
	const revision = query.getRevision();
	assert.equal(query.instantiate(file.callValues[0], summary.id, 0, 0, [argument], undefined), first);
	assert.equal(query.getRevision(), revision, 'retained call must not republish parameter bindings');
});

test('binding writes determine parameter storage, including unknown RHS and nested closures', () => {
	const file = buildLuaFileSemanticData([
		'local function read(value) return value end',
		'local function arithmetic(value) value = value + 1 return value end',
		'local function replace(value) function value() end return value end',
		'local function capture(value) local function set() value = 12 end return set end',
		'local function shadow(value) local function inner(value) value = 42 end return value end',
	].join('\n'), 'bindings.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	for (const [name, written] of [
		['read', false], ['arithmetic', true], ['replace', true], ['capture', true], ['shadow', false], ['inner', true],
	] as const) {
		const declaration = file.decls.find(entry => entry.name === name)!;
		const summary = summaries.get(summaries.summaryIdsForDeclaration(declaration.id)[0]);
		const binding = summaries.terms.compileSource(summary.source.parameters[0]);
		assert.equal(summaries.terms.kind(binding), written ? TermKind.Local : TermKind.Parameter, name);
		if (written) {
			assert.deepEqual(summary.aliases[0], { target: binding, source: summary.parameters[0], relation: 'value' });
		} else {
			assert.equal(binding, summary.parameters[0], 'a never-written binding needs no intermediate storage');
			assert.equal(summary.aliases.some(alias => alias.target === binding), false);
		}
	}
});

test('rebinding a parameter cannot merge the actual argument and replacement objects', () => {
	const source = [
		'local original<const> = { original = true }',
		'local replacement<const> = { replacement = true }',
		'local function change(value) value = replacement return value end',
		'local selected<const> = change(original)',
		'return original.original, original.replacement, replacement.original, selected.replacement',
	].join('\n');
	for (const names of [['original', 'replacement', 'selected'], ['selected', 'replacement', 'original']]) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('parameters.lua', source);
		const snapshot = workspace.getSnapshot();
		const file = snapshot.getFileData('parameters.lua')!;
		for (const name of names) {
			const declaration = file.decls.find(entry => entry.name === name && entry.kind === 'constant')!;
			const members = snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name).sort();
			assert.deepEqual(members, name === 'selected' ? ['original', 'replacement'] : [name], name);
		}
	}
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'parameters.lua'), [], {
		entrySource: source, programDomain: 'system', optLevel: 0,
	});
	assert.deepEqual(materializeCpuCompletionValues(runCompiledTestSystem(compiled, 100000)), [true, null, null, true]);
});

test('parameter rebinding stays local when the argument is another formal', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('forward.lua', [
		'local original<const> = { original = true }',
		'local replacement<const> = { replacement = true }',
		'local function change(value) value = replacement end',
		'local function forward(value) change(value) return value end',
		'local selected<const> = forward(original)',
		'return selected.original',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	const selected = snapshot.getFileData('forward.lua')!.decls.find(entry => entry.name === 'selected')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(selected.id)).map(entry => entry.name), ['original']);
});

test('a closure rebinds its captured formal without rebinding the original argument', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('capture.lua', [
		'local original<const> = { original = true }',
		'local replacement<const> = { replacement = true }',
		'local function make(value)',
		'\tlocal function change() value = replacement end',
		'\tchange()',
		'\treturn value',
		'end',
		'local selected<const> = make(original)',
		'return selected.replacement, original.original',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	for (const name of ['selected', 'original', 'replacement']) {
		const declaration = snapshot.getFileData('capture.lua')!.decls.find(entry => entry.name === name && entry.kind === 'constant')!;
		assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name).sort(),
			name === 'selected' ? ['original', 'replacement'] : [name], name);
	}
});

test('a called closure can also replace an ordinary captured local', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('local.lua', [
		'local function make()',
		'\tlocal value = { initial = true }',
		'\tlocal function change() value = { updated = true } end',
		'\tchange()',
		'\treturn value',
		'end',
		'local selected<const> = make()',
		'return selected.updated',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	const selected = snapshot.getFileData('local.lua')!.decls.find(entry => entry.name === 'selected')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(selected.id)).map(entry => entry.name).sort(), ['initial', 'updated']);
});

test('writing through a parameter still modifies the shared argument object', () => {
	const source = [
		'local original<const> = { original = true }',
		'local function attach(value) value.attached = true end',
		'attach(original)',
		'return original.original, original.attached',
	].join('\n');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('mutation.lua', source);
	const snapshot = workspace.getSnapshot();
	const original = snapshot.getFileData('mutation.lua')!.decls.find(entry => entry.name === 'original' && entry.kind === 'constant')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(original.id)).map(entry => entry.name).sort(), ['attached', 'original']);
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'mutation.lua'), [], {
		entrySource: source, programDomain: 'system', optLevel: 0,
	});
	assert.deepEqual(materializeCpuCompletionValues(runCompiledTestSystem(compiled, 100000)), [true, true]);
});

test('an omitted argument does not become shared writable storage', () => {
	const file = buildLuaFileSemanticData([
		'local function initialize(value) value = { found = true } return value end',
		'initialize()',
		'initialize()',
	].join('\n'), 'omitted.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const query = new SemanticInstantiationQuery(summaries, new SemanticDemandIndex([file], summaries), () => {});
	const summary = summaries.list()[0];
	const first = query.instantiate(file.callValues[0], summary.id, 0, 0, [], undefined);
	const second = query.instantiate(file.callValues[1], summary.id, 0, 0, [], undefined);
	const binding = summaries.terms.compileSource(summary.source.parameters[0]);
	assert.notEqual(query.contextualize(binding, first), query.contextualize(binding, second));
	assert.equal(query.values.first(summaries.terms.unknown()), 0);
});

test('calls keep parameter and replacement pairs separate', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('pairs.lua', [
		'local left<const> = { left = true }',
		'local right<const> = { right = true }',
		'local red<const> = { red = true }',
		'local blue<const> = { blue = true }',
		'local function replace(value, replacement) value = replacement return value end',
		'local first<const> = replace(left, red)',
		'local second<const> = replace(right, blue)',
		'return first.red, second.blue',
	].join('\n'));
	const snapshot = workspace.getSnapshot();
	for (const [name, expected] of [
		['first', ['left', 'red']], ['second', ['blue', 'right']],
		['left', ['left']], ['right', ['right']], ['red', ['red']], ['blue', ['blue']],
	] as const) {
		const declaration = snapshot.getFileData('pairs.lua')!.decls.find(entry => entry.name === name && entry.kind === 'constant')!;
		assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name).sort(), expected, name);
	}
});

for (const [name, body, argument] of [
	['field', 'return items.factory()', '{ factory = create() }'],
	['element', 'local result; for _, factory in ipairs(items) do result = factory() end; return result', '{ create() }'],
] as const) {
	test(`producer demand follows a deferred callback through a parameter ${name}`, () => {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('callbacks.lua', [
			'local function create() return function() return { found = true } end end',
			`local function run(items) ${body} end`,
			`local result<const> = run(${argument})`,
			'return result.found',
		].join('\n'));
		const snapshot = workspace.getSnapshot();
		const result = snapshot.getFileData('callbacks.lua')!.decls.find(entry => entry.name === 'result' && entry.kind === 'constant')!;
		assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name), ['found']);
	});
}

for (const depth of [1, 2, 4]) {
	test(`indexed writes through a written formal retain ${depth} nested member locations`, () => {
		const path = '.inner'.repeat(depth);
		const storage = '{ inner = '.repeat(depth) + '{}' + ' }'.repeat(depth);
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('storage.lua', [
			`local left<const> = ${storage}`,
			`local right<const> = ${storage}`,
			'local red<const> = { red = true }',
			'local blue<const> = { blue = true }',
			`local function put(object, key, value) object = object; object${path}[key] = value end`,
			`local function get(object, key) return object${path}[key] end`,
			"put(left, 'item', red)",
			"put(right, 'item', blue)",
			"local first<const> = get(left, 'item')",
			"local second<const> = get(right, 'item')",
			'return first.red, second.blue',
		].join('\n'));
		const snapshot = workspace.getSnapshot();
		for (const [name, expected] of [['first', 'red'], ['second', 'blue']]) {
			const declaration = snapshot.getFileData('storage.lua')!.decls.find(entry => entry.name === name)!;
			assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name), [expected]);
		}
	});
}
