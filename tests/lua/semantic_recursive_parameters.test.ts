import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, type TermID, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { SemanticMemberQuery } from '../../toolchain/ts/lua/semantic/member_query';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';
import { appendValueMember, declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { runCompiledLua } from './cpu_test_harness';

test('a recursive edge contributes every incoming argument to the retained frame entry', () => {
	const file = buildLuaFileSemanticData(`local first = { first = true }
local second = { second = true }
local function walk(value, next)
	if next then return walk(next) end
	return value
end
walk(first, second)
walk(second, first)`, 'inputs.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const query = new SemanticInstantiationQuery(summaries, demand, () => {});
	const summary = summaries.list()[0];
	const [firstCall, secondCall] = demand.topLevelCalls;
	const outer = query.instantiate(firstCall.site, summary.id, 0, 0, firstCall.arguments, firstCall.result);
	const other = query.instantiate(secondCall.site, summary.id, 0, 0, secondCall.arguments, secondCall.result);
	const input = query.contextualize(summary.parameters[0], outer);
	const otherInput = query.contextualize(summary.parameters[0], other);
	assert.equal(summaries.terms.kind(input), TermKind.ContextRoot);
	assert.equal(summaries.terms.base(input), summary.parameters[0]);
	assert.notEqual(input, otherInput);
	const recursive = summary.calls[0];
	const argumentsInOuter: TermID[] = [];
	query.contextualizeCallArguments(recursive, outer, argumentsInOuter);
	const result = query.contextualizeCallResult(recursive, outer);
	assert.equal(query.instantiate(recursive.site, summary.id, 0, outer, argumentsInOuter, result), outer);
	const values: TermID[] = [];
	for (let link = query.values.first(input); link !== 0; link = query.values.next(link)) values.push(query.values.target(link));
	assert.deepEqual(values, [firstCall.arguments[0], query.contextualize(summary.parameters[1], outer)]);
	const nextInput = query.contextualize(summary.parameters[1], outer);
	const nextValues: TermID[] = [];
	for (let link = query.values.first(nextInput); link !== 0; link = query.values.next(link)) nextValues.push(query.values.target(link));
	assert.deepEqual(nextValues, [firstCall.arguments[1], summaries.terms.unknown()], 'the omitted recursive input uses the existing unknown representation');
	assert.equal(query.values.target(query.values.first(otherInput)), secondCall.arguments[0]);
	assert.equal(query.values.next(query.values.first(otherInput)), 0, 'another root call does not acquire the recursive edge');
	assert.equal(query.frames.count, 2);
	const revision = query.getRevision();
	query.instantiate(recursive.site, summary.id, 0, outer, argumentsInOuter, result);
	assert.equal(query.getRevision(), revision, 'the same edge contributes once');
});

for (const mutual of [false, true]) {
	for (const depth of [1, 32]) {
		test(`${mutual ? 'mutual' : 'direct'} recursion reaches later objects at depth ${depth} without mixing root calls`, () => {
			const source = `local left = { left = 11 }
local right = { right = 22 }
local walk
${mutual ? 'local function hop(value) return walk(value) end' : ''}
walk = function(value)
	if value.next then return ${mutual ? 'hop' : 'walk'}(value.next) end
	return value
end
local first = walk(${'{ next = '.repeat(depth)}left${' }'.repeat(depth)})
local second = walk(${'{ next = '.repeat(depth)}right${' }'.repeat(depth)})
return first.left, second.right`;
			for (const order of [['first', 'second'], ['second', 'first']]) {
				const workspace = new LuaSemanticWorkspace();
				workspace.updateFile('chains.lua', source);
				const snapshot = workspace.getSnapshot();
				const file = snapshot.getFileData('chains.lua')!;
				for (const name of order) {
					const declaration = file.decls.find(entry => entry.name === name)!;
					const expected = name === 'first' ? ['left', 'next'] : ['next', 'right'];
					assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name).sort(), expected);
				}
				const metrics = snapshot.symbolResolver.getSemanticQueryMetrics();
				assert.equal(metrics.instantiatedCalls, mutual ? 4 : 2, 'chain length does not grow analysis frames');
				for (const name of order) {
					const declaration = file.decls.find(entry => entry.name === name)!;
					snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id));
				}
				assert.deepEqual(snapshot.symbolResolver.getSemanticQueryMetrics(), metrics, 'repeated reads retain the solved facts');
			}
			for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'chains.lua', level), [11, 22]);
		});
	}
}

test('recursive indexed reads follow retained element storage instead of growing access paths', () => {
	const source = `local leaf = { marker = 11 }
local root = { { { leaf } } }
local function walk(value, key)
	if value[key] then return walk(value[key], key) end
	return value
end
local result = walk(root, 1)
return result.marker`;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('indexed.lua', source);
	const snapshot = workspace.getSnapshot();
	const result = snapshot.getFileData('indexed.lua')!.decls.find(entry => entry.name === 'result')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name), ['marker']);
	assert.equal(snapshot.symbolResolver.getSemanticQueryMetrics().instantiatedCalls, 1);
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'indexed.lua', level), [11]);
});

test('an unmodelled index retains the existing aggregate-element representation', () => {
	const source = `local function read(items, key) return items[key] end
local result = read({ { found = true } }, 1 + 0)
return result.found`;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('unknown_index.lua', source);
	const snapshot = workspace.getSnapshot();
	const result = snapshot.getFileData('unknown_index.lua')!.decls.find(entry => entry.name === 'result')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name), ['found']);
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'unknown_index.lua', level), [true]);
});

test('a cyclic object graph reaches a fixed point without executing the program', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('cycle.lua', `local node = { marker = true }
node.next = node
local function walk(value) return walk(value.next) or value end
local result = walk(node)`);
	const snapshot = workspace.getSnapshot();
	const result = snapshot.getFileData('cycle.lua')!.decls.find(entry => entry.name === 'result')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name).sort(), ['marker', 'next']);
	assert.equal(snapshot.symbolResolver.getSemanticQueryMetrics().instantiatedCalls, 1);
});

test('a recursive callback argument is not replaced by the first callback forever', () => {
	const source = `local function first() return { early = true } end
local function second() return { late = true } end
local function run(callback, next)
	if next then return run(next) end
	return callback()
end
local result = run(first, second)
return result.late`;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('callbacks.lua', source);
	const snapshot = workspace.getSnapshot();
	const result = snapshot.getFileData('callbacks.lua')!.decls.find(entry => entry.name === 'result')!;
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name).sort(), ['early', 'late']);
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'callbacks.lua', level), [true]);
});

for (const [name, body, argument, expected] of [
	['field', 'return items.value', '{ value = create() }', 'found'],
	['index', 'return items[1]', '{ create() }', 'found'],
	['element', 'local result; for _, item in ipairs(items) do result = item end; return result', '{ create() }', 'found'],
	['nested', 'return items.value.data', '{ value = create() }', 'nested'],
] as const) {
	test(`value demand follows a deferred non-call result through a parameter ${name}`, () => {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('values.lua', `local function create() return { found = true, data = { nested = true } } end
local function run(items) ${body} end
local selected = run(${argument})
return selected.${expected}`);
		const snapshot = workspace.getSnapshot();
		const result = snapshot.getFileData('values.lua')!.decls.find(entry => entry.name === 'selected')!;
		const names = snapshot.symbolResolver.getMembers(declarationValueSource(result.id)).map(entry => entry.name).sort();
		assert.deepEqual(names, name === 'nested' ? ['nested'] : ['data', 'found']);
		assert.equal(snapshot.symbolResolver.getSemanticQueryMetrics().instantiatedCalls, 2, 'the value producer is required even without a callback invocation');
	});
}

for (const access of ['holder.item', 'holder[1]']) {
	test(`nested indexed storage is shared through the computed actual ${access}`, () => {
		const source = `local left = { inner = { inner = {} } }
local right = { inner = { inner = {} } }
local red = { red = true }
local blue = { blue = true }
local function put(object, key, value) object = object; object.inner.inner[key] = value end
local function get(object, key) return object.inner.inner[key] end
local function store(holder, value) put(${access}, 1, value); return get(${access}, 1) end
local first = store({ item = left, left }, red)
local second = store({ item = right, right }, blue)
return first.red, second.blue`;
		for (const order of [['first', 'second'], ['second', 'first']]) {
			const workspace = new LuaSemanticWorkspace();
			workspace.updateFile('storage.lua', source);
			const snapshot = workspace.getSnapshot();
			for (const name of order) {
				const declaration = snapshot.getFileData('storage.lua')!.decls.find(entry => entry.name === name)!;
				assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name), [name === 'first' ? 'red' : 'blue']);
			}
		}
		for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'storage.lua', level), [true, true]);
	});
}

test('a reverse storage alias does not import the other values of a writable binding', () => {
	const source = `local left = { inner = { value = { left = true } } }
local right = { inner = { value = { right = true } } }
local function get(value, replacement)
	value = replacement
	return value.inner.value
end
local selected = get(left, right)
local first = left.inner.value
local second = right.inner.value
return selected.right, first.left, second.right`;
	for (const order of [['selected', 'first', 'second'], ['second', 'first', 'selected']]) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('aliases.lua', source);
		const snapshot = workspace.getSnapshot();
		for (const name of order) {
			const declaration = snapshot.getFileData('aliases.lua')!.decls.find(entry => entry.name === name)!;
			const expected = name === 'selected' ? ['left', 'right'] : [name === 'first' ? 'left' : 'right'];
			assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration.id)).map(entry => entry.name).sort(), expected);
		}
	}
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'aliases.lua', level), [true, true, true]);
});

test('reading a missing member does not create a location in the term store', () => {
	const file = buildLuaFileSemanticData('local object = { existing = true }', 'locations.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const query = new SemanticInstantiationQuery(summaries, new SemanticDemandIndex([file], summaries), () => assert.fail('no calls'));
	const members = new SemanticMemberQuery(summaries, query);
	const source = declarationValueSource(file.decls.find(entry => entry.name === 'object')!.id);
	const base = summaries.terms.compileSource(source);
	const name = summaries.terms.nameId('missing');
	const declarations: Parameters<SemanticMemberQuery['resolveMembers']>[2] = [];
	assert.equal(summaries.terms.retainedMember(base, name), undefined);
	members.resolveMembers(source, name, declarations);
	assert.deepEqual(declarations, []);
	assert.equal(summaries.terms.retainedMember(base, name), undefined, 'a lookup cannot manufacture a storage path');
});

test('function queries solve deferred read producers before retaining their answer', () => {
	const file = buildLuaFileSemanticData(`local function target() return true end
local function create() return { value = target } end
local function extract(items) return items.item.value end
local result = extract({ item = create() })`, 'functions.lua');
	const query = new LuaSemanticQueryStore([file], new Map());
	const result = declarationValueSource(file.decls.find(entry => entry.name === 'result')!.id);
	const target = file.decls.find(entry => entry.name === 'target')!;
	assert.deepEqual(query.functions(result), [target.id], 'no preceding member query primes the answer');
	const metrics = query.metrics();
	assert.deepEqual(query.functions(result), [target.id]);
	assert.deepEqual(query.metrics(), metrics);
});

test('a parameter key alone does not make an indexed write escape its local table', () => {
	const file = buildLuaFileSemanticData(`local function scratch(key)
	local storage = {}
	storage[key] = 11
end
local function outer(key) scratch(key) end`, 'effects.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const outer = summaries.list()[1];
	assert.deepEqual(demand.compositionCalls(outer.id), []);
});

test('separate closures keep captured values apart while their recursive inputs accumulate', () => {
	const source = `local function make(token)
	local function walk(value)
		if value.next then return walk(value.next) end
		return { token = token, item = value }
	end
	return walk
end
local left = make({ left = 11 })
local right = make({ right = 22 })
local first = left({ next = { leaf_left = true } })
local second = right({ next = { leaf_right = true } })
return first.token.left, second.token.right, first.item.leaf_left, second.item.leaf_right`;
	for (const order of [['first', 'second'], ['second', 'first']]) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('closures.lua', source);
		const snapshot = workspace.getSnapshot();
		for (const name of order) {
			const declaration = snapshot.getFileData('closures.lua')!.decls.find(entry => entry.name === name)!;
			const value = declarationValueSource(declaration.id);
			assert.deepEqual(snapshot.symbolResolver.getMembers(appendValueMember(value, 'token')).map(entry => entry.name), [name === 'first' ? 'left' : 'right']);
			assert.deepEqual(snapshot.symbolResolver.getMembers(appendValueMember(value, 'item')).map(entry => entry.name).sort(), [name === 'first' ? 'leaf_left' : 'leaf_right', 'next']);
		}
	}
	for (const level of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'closures.lua', level), [11, 22, true, true]);
});
