import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource, globalValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { semanticSnapshot } from './semantic_test_harness';

test('global writes own occurrences while every unbound read names raw storage', () => {
	const file = buildLuaFileSemanticData('value = 1; value = 2; return value', 'globals.lua');
	const declarations = file.decls.filter(decl => decl.name === 'value');
	assert.equal(declarations.length, 2);
	assert.notEqual(declarations[0].id, declarations[1].id);
	assert.deepEqual(file.declarationValues.map(write => write.declId), declarations.map(decl => decl.id));
	assert.deepEqual(file.valueAssignments.map(write => write.target), [globalValueSource('value'), globalValueSource('value')]);
	assert.deepEqual(file.valueAssignments.map(write => write.source), declarations.map(decl => declarationValueSource(decl.id)));
	assert.equal(file.refs[2].target, undefined);
	assert.equal(file.refs[2].binding, undefined);
	assert.deepEqual(file.moduleValues[0].source, globalValueSource('value'));
	assert.deepEqual(file.globalStorageDecls, declarations);
});

test('lexical reassignment remains one binding and does not publish a global write', () => {
	const file = buildLuaFileSemanticData('local value = 1; value = 2; return value', 'locals.lua');
	assert.equal(file.decls.length, 1);
	assert.deepEqual(file.declarationValues.map(write => write.declId), [file.decls[0].id, file.decls[0].id]);
	assert.deepEqual(file.valueAssignments, []);
	assert.deepEqual(file.globalStorageDecls, []);
	assert.deepEqual(file.moduleValues[0].source, declarationValueSource(file.decls[0].id));
});

test('sibling global writers retain their own contextual RHS and publication flow', () => {
	const file = buildLuaFileSemanticData([
		'local function first(input) shared = input end',
		'local function second(input) shared = input end',
		'return shared',
	].join('\n'), 'writers.lua');
	const [first, second] = file.functionValueFlows;
	assert.deepEqual(file.valueAssignments, []);
	for (const flow of [first, second]) {
		const write = file.declarationValues.find(entry => entry.flow === flow.id)!;
		assert.ok(flow.declarationIds.includes(write.declId));
		assert.deepEqual(flow.assignments.map(entry => entry.target), [globalValueSource('shared')]);
		assert.deepEqual(flow.assignments[0].source, declarationValueSource(write.declId));
		assert.deepEqual(write.source, flow.parameters[0]);
	}
	assert.notEqual(first.assignments[0].source.root, second.assignments[0].source.root);
});

test('a written global occurrence has only its RHS while raw storage gathers all occurrences', () => {
	const file = buildLuaFileSemanticData('value = 1; value = 2; return value', 'origins.lua');
	const query = semanticSnapshot(file).symbolResolver.writtenSources;
	const [first, second] = file.declarationValues;
	for (const write of [first, second]) {
		const declaration = file.decls.find(decl => decl.id === write.declId)!;
		const transfer = file.valueAssignments.find(entry => entry.source.root.kind === 'declaration' && entry.source.root.declId === declaration.id)!;
		const inputs = query.inputs({ kind: 'value-transfer', file, write: transfer, flow: undefined, value: transfer.source });
		assert.ok(inputs.kind === 'contributions');
		assert.deepEqual(inputs.sources, [query.write(write)]);
	}
	const last = file.chunk.body.get(2)!;
	assert.ok(last.kind === LuaSyntaxKind.ReturnStatement);
	const inputs = query.inputs(query.expression(file, last.expressions[0]));
	assert.ok(inputs.kind === 'contributions');
	assert.deepEqual(inputs.sources, [query.write(first), query.write(second)]);
});
