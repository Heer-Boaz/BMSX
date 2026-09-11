import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticInstantiationQuery } from '../../toolchain/ts/lua/semantic/instantiate';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, NIL_VALUE_SOURCE, semanticValueSourcesEqual } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompiledLua } from './cpu_test_harness';
import { semanticSymbolsAt } from './semantic_test_harness';

test('written contributions retain equal-valued occurrences and self-assignment in their actual body', () => {
	const source = [
		'local value',
		'value = 1',
		'value = 1',
		'value = value',
		'local function reset() value = 1; value = 1 end',
		'return value',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'writes.lua');
	const declaration = file.decls.find(item => item.name === 'value')!;
	const contributions = file.declarationValues.filter(item => item.declId === declaration.id);
	assert.equal(contributions.length, 6);
	assert.equal(contributions[0].source, NIL_VALUE_SOURCE);
	assert.equal(contributions[0].syntax, file.chunk.body[0]);
	assert.equal(contributions[1].syntax, file.chunk.body[1]);
	assert.equal(contributions[2].syntax, file.chunk.body[2]);
	assert.ok(semanticValueSourcesEqual(contributions[1].source, contributions[2].source));
	assert.equal(contributions[3].syntax, file.chunk.body[3]);
	assert.ok(semanticValueSourcesEqual(contributions[3].source, declarationValueSource(declaration.id)));
	assert.ok(contributions.slice(0, 4).every(item => item.flow === undefined && item.index === 0));
	const flow = file.functionValueFlows[0];
	assert.equal(contributions[4].flow, flow);
	assert.equal(contributions[4].syntax, flow.expression.body.body[0]);
	assert.equal(contributions[5].syntax, flow.expression.body.body[1]);
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	assert.equal(summaries.list()[0].aliases.length, 1, 'summary terms deduplicate values without erasing written occurrences');
	assert.deepEqual(runCompiledLua(source), [1]);
});

test('unmodeled expressions and compound writes retain unknown rather than aliasing the RHS', () => {
	const source = [
		'local function compute(input)',
		' local value = input',
		' value = input + 2',
		' value += 9',
		' return value',
		'end',
		'return compute(3)',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'compound.lua');
	const value = file.decls.find(item => item.name === 'value')!;
	const contributions = file.declarationValues.filter(item => item.declId === value.id);
	assert.equal(contributions.length, 3);
	assert.equal(contributions[0].source.root.kind, 'declaration');
	assert.equal(contributions[1].source.root.kind, 'unknown');
	assert.equal(contributions[2].source.root.kind, 'unknown');
	assert.equal(contributions[1].source, contributions[2].source, 'the abstract unknown is retained without per-expression allocation');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	assert.ok(summaries.list()[0].aliases.some(item => item.source === summaries.terms.unknown()));
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'compound.lua', optimization), [14]);

	const functionOperand = buildLuaFileSemanticData('local value = 1; value += function() return 9 end', 'operand.lua');
	assert.equal(functionOperand.functionValueFlows[0].declaration, undefined, 'a compound RHS closure is not the assigned function');
	assert.equal(functionOperand.declarationValues[1].source.root.kind, 'unknown');
	assert.equal(functionOperand.decls.find(item => item.name === 'value')!.signature, undefined);
});

test('short assignments distinguish nil padding from unmodeled expanded result lanes', () => {
	const source = [
		'local function pair() return 7, 8 end',
		'local first, second, third = 4',
		'local left, right = pair()',
		'first, second, third = 5',
		'left, right = 6, pair()',
		'return first, second == nil, third == nil, left, right',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'lanes.lua');
	const values = file.declarationValues;
	const paddedLocal = values.filter(item => item.syntax === file.chunk.body[1]);
	assert.deepEqual(paddedLocal.map(item => item.index), [0, 1, 2]);
	assert.equal(paddedLocal[1].source, NIL_VALUE_SOURCE);
	assert.equal(paddedLocal[2].source, NIL_VALUE_SOURCE);
	const expandedLocal = values.filter(item => item.syntax === file.chunk.body[2]);
	assert.equal(expandedLocal.length, 2);
	assert.equal(expandedLocal[0].source.root.kind, 'owned');
	assert.equal(expandedLocal[1].source.root.kind, 'unknown');
	const paddedAssignment = values.filter(item => item.syntax === file.chunk.body[3]);
	assert.deepEqual(paddedAssignment.map(item => item.index), [0, 1, 2]);
	assert.equal(paddedAssignment[1].source, NIL_VALUE_SOURCE);
	assert.equal(paddedAssignment[2].source, NIL_VALUE_SOURCE);
	for (const optimization of [0, 3] as const) {
		assert.deepEqual(runCompiledLua(source, 'lanes.lua', optimization), [5, true, true, 6, 7]);
	}

	const varargs = buildLuaFileSemanticData('return function(...) local left, right = ...; left, right = ... end', 'varargs.lua');
	assert.equal(varargs.declarationValues.length, 4);
	assert.ok(varargs.declarationValues.every(item => item.source.root.kind === 'unknown'));
});

test('parallel RHS references keep the prior scope and surplus RHS still bind calls', () => {
	const source = [
		'local left = 3',
		'local calls = 0',
		'local function count() calls += 1; return calls end',
		'do',
		' local left, right = 9, left, count()',
		' left, right = right, left, count()',
		' return left, right, calls',
		'end',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'parallel.lua');
	const block = file.chunk.body[3];
	assert.ok(block.kind === LuaSyntaxKind.DoStatement);
	const declaration = file.decls.find(item => item.name === 'left')!;
	const initializers = file.declarationValues.filter(item => item.syntax === block.block.body[0]);
	assert.equal(initializers.length, 2);
	assert.ok(semanticValueSourcesEqual(initializers[1].source, declarationValueSource(declaration.id)));
	assert.equal(file.callValues.length, 2, 'surplus calls are not discarded with their unused result');
	for (const optimization of [0, 3] as const) {
		assert.deepEqual(runCompiledLua(source, 'parallel.lua', optimization), [3, 9, 2]);
	}
});

test('table writes and logical operand transfers retain real fields and unmodeled contributions', () => {
	const source = [
		'local data<const> = { named = 1 + 2, [1] = 2 + 3, 3 + 4, ["other"] = -5 }',
		'data[1] = 4 + 5',
		'data[2], data[3] = 6',
		'local selected = data or (1 + 2)',
		'local both = (3 + 4) and data',
		'return data.named, data[1], data[2], data[3] == nil, data.other, selected == data, both == data',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'tables.lua');
	const declaration = file.chunk.body[0];
	assert.ok(declaration.kind === LuaSyntaxKind.LocalAssignmentStatement);
	const constructor = declaration.values[0];
	const fields = file.declarationValues.filter(item => item.syntax === constructor);
	assert.deepEqual(fields.map(item => item.index), [0, 3]);
	assert.ok(fields.every(item => item.source.root.kind === 'unknown'));
	const arrayFields = file.valueAssignments.filter(item => item.syntax === constructor);
	assert.deepEqual(arrayFields.map(item => item.index), [1, 2]);
	assert.ok(arrayFields.every(item => item.source.root.kind === 'unknown'));
	const indexed = file.valueAssignments.filter(item => item.syntax.kind === LuaSyntaxKind.AssignmentStatement);
	assert.equal(indexed.length, 3);
	assert.equal(indexed[0].source.root.kind, 'unknown');
	assert.equal(indexed[2].source, NIL_VALUE_SOURCE);
	const operands = file.valueAssignments.filter(item => item.syntax.kind === LuaSyntaxKind.BinaryExpression);
	assert.deepEqual(operands.map(item => item.index), [0, 1, 0, 1]);
	assert.equal(operands[1].source.root.kind, 'unknown');
	assert.equal(operands[2].source.root.kind, 'unknown');
	for (const optimization of [0, 3] as const) {
		assert.deepEqual(runCompiledLua(source, 'tables.lua', optimization), [3, 9, 6, true, -5, true, true]);
	}
});

test('folded local initializer positions cannot clobber later scalar, closure or expanded results', () => {
	const fixtures = [
		{
			source: 'local outer = 3; local a, b, c, d = 9, outer, 8, outer; return a, b, c, d',
			expected: [9, 3, 8, 3],
		},
		{
			source: 'local outer = 3; local a<const>, b, c<const>, d = 9, outer, 8, outer; return a, b, c, d',
			expected: [9, 3, 8, 3],
		},
		{
			source: 'local function pair() return 3, 4 end; local a, b, c, d = 9, pair(); return a, b, c, d == nil',
			expected: [9, 3, 4, true],
		},
		{
			source: 'local outer = 3; local a, b = 9, function() return outer end; return a, b()',
			expected: [9, 3],
		},
		{
			source: 'local outer = 3; local a, b, c = 9, outer, 8, function() return 10 end; return a, b, c',
			expected: [9, 3, 8],
		},
	];
	for (const fixture of fixtures) {
		for (const optimization of [0, 3] as const) {
			assert.deepEqual(runCompiledLua(fixture.source, 'initializer-slots.lua', optimization), fixture.expected);
		}
	}
});

test('unknown constants and exports do not collapse unrelated storage identities', () => {
	const first = buildLuaFileSemanticData('local first<const> = 1 + 2; local second<const> = 3 + 4; return 5 + 6', 'first.lua');
	const second = buildLuaFileSemanticData('return 7 + 8', 'second.lua');
	assert.ok(first.declarationValues.every(item => item.relation === 'value' && item.source.root.kind === 'unknown'));
	assert.equal(first.moduleValues[0].source.root.kind, 'unknown');
	const identities = new WorkspaceValueIdentityIndex({ files: [first, second], globalValues: new Map() });
	const roots = first.declarationValues.map(item => identities.canonicalRoot(identities.rawRootId({ kind: 'declaration', declId: item.declId })));
	for (const file of [first, second]) {
		roots.push(identities.canonicalRoot(identities.rawRootId({ kind: 'module', module: file.moduleValues[0].module })));
	}
	roots.push(identities.canonicalRoot(identities.rawRootId(first.moduleValues[0].source.root)));
	assert.equal(new Set(roots).size, roots.length);
});

test('instantiation publishes a captured unknown write only from the called body', () => {
	const source = 'local selected = 7; local function change() selected = 1 + 2 end; change(); return selected';
	const file = buildLuaFileSemanticData(source, 'called-write.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const query = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('the written body has no nested calls'));
	const selected = file.decls.find(item => item.name === 'selected')!;
	const target = summaries.terms.compileSource(declarationValueSource(selected.id));
	const initial = query.values.first(target);
	assert.notEqual(initial, 0);
	assert.equal(query.values.next(initial), 0);
	assert.notEqual(query.values.target(initial), summaries.terms.unknown());
	const call = demand.topLevelCalls[0];
	query.instantiate(call.site, summaries.list()[0].id, 0, 0, call.arguments, call.result);
	const written = query.values.next(initial);
	assert.notEqual(written, 0);
	assert.equal(query.values.target(written), summaries.terms.unknown());
	assert.equal(query.values.next(written), 0);
	for (const optimization of [0, 3] as const) assert.deepEqual(runCompiledLua(source, 'called-write.lua', optimization), [3]);
});

test('equal scalar and unknown alternatives never establish a shared member-write location', () => {
	for (const value of ['nil', 'false', '0', "'same'", '1 + 2']) {
		const source = [
			'local active = false',
			'local left, right',
			'left, right = {}, {}',
			`if active then left = ${value}; right = ${value} end`,
			'right.right_only = true',
			'return left.right_only',
		].join('\n');
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('unrelated.lua', source);
		assert.deepEqual(semanticSymbolsAt(workspace.getSnapshot(), 'unrelated.lua', 6, 14), [], value);
		for (const optimization of [0, 3] as const) {
			assert.deepEqual(runCompiledLua(source.replace('return left.right_only', 'return left.right_only == nil'), 'unrelated.lua', optimization), [true]);
		}
	}
});

test('scalar alternatives cannot join unrelated prototype owners', () => {
	const source = [
		'local active = false',
		'local left, right = {}, {}',
		'if active then left = nil; right = nil end',
		'setmetatable(left, { __index = { left_only = true } })',
		'return right.left_only',
	].join('\n');
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('prototypes.lua', source);
	assert.deepEqual(semanticSymbolsAt(workspace.getSnapshot(), 'prototypes.lua', 5, 15), []);
	// Publish the real boot primitive from a system module, before startup clears
	// its private bindings. This is the same owner route as BIOS base.lua.
	const bootSource = 'setmetatable = __bmsx_setmetatable';
	const entrySource = "require('test_boot')\n" + source.replace('return right.left_only', 'return right.left_only == nil');
	for (const optimization of [0, 3] as const) {
		const compiled = compileLuaChunkToProgram(parseLuaChunk(entrySource, 'prototypes.lua'), [
			{ path: 'test_boot', source: bootSource, chunk: parseLuaChunk(bootSource, 'test_boot.lua') },
		], { entrySource, optLevel: optimization, programDomain: 'system' });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	}
});

test('term identity classification is fixed before const aliases or their access paths are compiled', () => {
	const file = buildLuaFileSemanticData('local key<const> = "same"; local table<const> = {}', 'classification.lua');
	const identities = new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() });
	const summaries = new FunctionSummaryStore([file], identities);
	const terms = summaries.terms;
	const key = terms.compileSource(declarationValueSource(file.decls[0].id));
	const member = terms.member(key, terms.nameId('invalid'));
	assert.equal(terms.hasLocationIdentity(key), false);
	assert.equal(terms.hasLocationIdentity(member), false);
	assert.equal(terms.isUnknown(key), false, 'a known scalar is not unknown');
	assert.equal(terms.compileSource(file.declarationValues[0].source), key);
	assert.equal(terms.hasLocationIdentity(member), false, 'literal compilation cannot change an already retained path classification');
	const object = terms.compileSource(declarationValueSource(file.decls[1].id));
	assert.equal(terms.hasLocationIdentity(object), true);
	assert.equal(terms.hasLocationIdentity(terms.member(object, terms.nameId('valid'))), true);
	const unknownPath = terms.member(terms.unknown(), terms.nameId('unresolved'));
	assert.equal(terms.isUnknown(unknownPath), true);
	assert.equal(terms.hasLocationIdentity(unknownPath), false);
	const demand = new SemanticDemandIndex([file], summaries);
	assert.deepEqual(demand.relatedTerms(terms.unknown()), []);
	assert.deepEqual(demand.relatedTerms(key), [], 'equal scalar values do not index reverse storage aliases');
});

test('iteration contributions keep their producer syntax, not fabricated initializer expressions', () => {
	const file = buildLuaFileSemanticData('for i = 1, 3 do end; for key, value, extra in pairs({}) do end', 'loops.lua');
	assert.deepEqual(file.declarationValues.map(item => item.index), [0, 0, 1, 2]);
	assert.equal(file.declarationValues[0].syntax, file.chunk.body[0]);
	assert.ok(file.declarationValues.slice(1).every(item => item.syntax === file.chunk.body[1]));
	assert.equal(file.declarationValues[2].relation, 'projection');
	assert.equal(file.declarationValues[2].source.steps[0].kind, 'element');
	for (const index of [0, 1, 3]) assert.equal(file.declarationValues[index].source.root.kind, 'unknown');
});

test('written origins belong to immutable file facts, not the current workspace text', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('provider.lua', 'local value = 1; value = 1; return value');
	workspace.updateFile('consumer.lua', "return require('provider')");
	const before = workspace.getSnapshot();
	const provider = before.getFileData('provider.lua')!;
	workspace.updateFile('consumer.lua', "local value = require('provider'); return value");
	assert.equal(workspace.getSnapshot().getFileData('provider.lua'), provider);
	workspace.updateFile('provider.lua', 'local value = 1; value = 2; return value');
	const after = workspace.getSnapshot().getFileData('provider.lua')!;
	assert.equal(provider.declarationValues[1].syntax, provider.chunk.body[1]);
	assert.equal(after.declarationValues[1].syntax, after.chunk.body[1]);
	assert.notEqual(after.declarationValues[1].syntax, provider.declarationValues[1].syntax);
	assert.notDeepEqual(after.declarationValues[1].source, provider.declarationValues[1].source);
});
