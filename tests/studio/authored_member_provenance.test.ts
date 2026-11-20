import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../toolchain/ts/lua/syntax/table_fields';
import { createPathModuleBindingsFixture, createPathModuleProjectFixture } from '../helpers/lua_semantic_project';

function sourceQuery(source: string, providers: Readonly<Record<string, string>> = {}) {
	const file = buildLuaFileSemanticData(source, 'consumer.lua');
	const files = [file, ...Object.entries(providers).map(([path, source]) => buildLuaFileSemanticData(source, path))];
	for (const file of files) assert.equal(file.syntaxError, null);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files.map(file => ({ path: file.file, source: file.source, analysis: file }))));
	const resolver = snapshot.symbolResolver, query = resolver.authoredSources, written = resolver.writtenSources;
	const returned = file.chunk.body.get(file.chunk.body.length - 1);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const roots = returned.expressions.map(expression => written.expression(file, expression));
	return { file, files, snapshot, resolver, query, written, roots };
}

test('same-named members and shadowed bindings never merge unrelated constructor occurrences', () => {
	const f = sourceQuery(`local left = { input = {} }
local right = { input = {} }
do local left = right; left.input = {} end
return left.input, right.input`);
	const first = f.file.chunk.body.get(0);
	assert.ok(first.kind === LuaSyntaxKind.LocalAssignmentStatement && first.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
	const expected = findNamedLuaTableField(first.values[0], 'input')!.value;
	const left = f.query.trace(f.roots[0]), right = f.query.trace(f.roots[1]);
	assert.equal(left.boundaries.length, 0); assert.equal(left.terminals.length, 1);
	assert.ok(left.terminals[0].value.root.kind === 'owned'); assert.equal(left.terminals[0].value.root.syntax, expected);
	assert.equal(left.memberReads[0].origins.length, 1); assert.equal(right.memberReads[0].origins.length, 2);
	assert.ok(right.boundaries.some(boundary => boundary.reason === 'competing-writes'));
	assert.ok(right.terminals.every(source => !left.terminals.includes(source)));
});

test('cross-module receiver and value aliases retain their own provider writes', () => {
	const f = sourceQuery(`local definitions = require('left')
local alias = definitions
local other = require('right')
return alias.input, other.input`, {
		'left.lua': 'local definitions={}; local value={}; local alias=definitions; alias.input=value; return definitions',
		'right.lua': 'local definitions={input={}}; return definitions',
	});
	const left = f.query.trace(f.roots[0]), right = f.query.trace(f.roots[1]);
	for (const [index, trace] of [left, right].entries()) {
		assert.equal(trace.boundaries.length, 0); assert.equal(trace.terminals.length, 1);
		assert.equal(trace.terminals[0].file, f.files[index + 1]);
		assert.equal(trace.memberReads[0].origins[0].file, f.files[index + 1]);
		assert.ok(trace.sources.some(source => source.file === f.files[index + 1] && !trace.terminals.includes(source)));
	}
	assert.notEqual(left.terminals[0], right.terminals[0]);
});

test('a known member never erases an uncertain receiver lane or an uncertain writer receiver', () => {
	for (const source of [
		'local definitions={input={}}; local base=external or definitions; return base.input',
		'local definitions={input={}}; local base=external or definitions; base.input={}; return definitions.input',
	]) {
		const f = sourceQuery(source), trace = f.query.trace(f.roots[0]);
		assert.ok(trace.terminals.length > 0);
		assert.ok(trace.boundaries.some(boundary => boundary.reason === 'unbound-global'));
		assert.ok(trace.memberReads.length > 0);
		assert.ok(trace.sources.includes(trace.memberReads[0].base));
	}
});

test('repeated member writes remain distinct even when their RHS reaches the same constructor', () => {
	const f = sourceQuery('local definitions={}; local shared={}; definitions.input=shared; definitions.input=shared; return definitions.input, shared');
	const trace = f.query.trace(f.roots[0]), shared = f.query.trace(f.roots[1]);
	assert.equal(trace.memberReads.length, 1);
	const origins = trace.memberReads[0].origins;
	assert.equal(origins.length, 2); assert.notEqual(origins[0], origins[1]);
	assert.ok(origins[0].kind === 'declaration-write' && origins[1].kind === 'declaration-write');
	assert.notEqual(origins[0].write, origins[1].write); assert.notEqual(origins[0].write.syntax, origins[1].write.syntax);
	assert.equal(trace.terminals.length, 1); assert.equal(trace.terminals[0], shared.terminals[0]);
	assert.ok(trace.boundaries.some(boundary => boundary.reason === 'competing-writes'));
});

test('cyclic alias dependencies terminate without dropping their unknown input', () => {
	const f = sourceQuery(`local left=external
local right=left
left=right
local definitions={input={}}
definitions.self=definitions
return left.input, definitions.self.input`);
	const unknown = f.query.trace(f.roots[0]), known = f.query.trace(f.roots[1]);
	assert.equal(unknown.terminals.length, 0);
	assert.ok(unknown.boundaries.some(boundary => boundary.reason === 'unbound-global'));
	assert.equal(known.boundaries.length, 0); assert.equal(known.terminals.length, 1); assert.equal(known.memberReads.length, 2);
	assert.equal(f.query.trace(f.roots[0]), unknown); assert.equal(f.query.trace(f.roots[1]), known);
});

test('authored members do not promote locally known or imported call results into table identities', () => {
	const f = sourceQuery(`local function make() return {input={}} end
local imported=require('factory')
local value=make()
return value.input, make().input, imported().input`, { 'factory.lua': 'return function() return {input={}} end' });
	for (const root of f.roots) {
		const trace = f.query.trace(root);
		assert.equal(trace.terminals.length, 0);
		assert.ok(trace.boundaries.some(boundary => boundary.reason === 'call-result'));
		assert.ok(trace.memberReads.every(member => member.origins.length === 0));
	}
});

test('computed writes and prototype changes retain uncertainty without borrowing prototype members', () => {
	for (const [source, reason, terminalCount] of [
		['local definitions={input={}}; definitions[key]={}; return definitions.input', 'computed-write', 1],
		['local definitions={input={}}; setmetatable(definitions,{__index=external}); return definitions.input', 'prototype-write', 1],
		['local definitions={}; setmetatable(definitions,{__index={input={}}}); return definitions.input', 'prototype-write', 0],
	] as const) {
		const f = sourceQuery(source), trace = f.query.trace(f.roots[0]);
		assert.equal(trace.terminals.length, terminalCount);
		assert.ok(trace.boundaries.some(boundary => boundary.reason === reason));
		assert.equal(trace.memberReads[0].origins.length, terminalCount);
	}
});

test('descendant mutation reaches the nested constructor and its containers but not an unrelated same shape', () => {
	const f = sourceQuery(`local leaf={tag=1}
local nested={leaf=leaf}
local definitions={nested=nested}
local alias=definitions.nested.leaf
alias.extra=2
local other={nested={leaf={}}}
return definitions, nested, leaf, other, other.nested, other.nested.leaf`);
	const tables = f.roots.map(root => {
		const trace = f.query.trace(root); assert.equal(trace.terminals.length, 1); assert.equal(trace.boundaries.length, 0);
		const value = trace.terminals[0].value.root;
		assert.ok(value.kind === 'owned' && value.syntax.kind === LuaSyntaxKind.TableConstructorExpression);
		return value.syntax;
	});
	const mutations = f.query.tableMutations();
	for (const table of tables.slice(0, 3)) assert.equal(mutations.has(table), true);
	for (const table of tables.slice(3)) assert.equal(mutations.has(table), false);
	assert.equal(f.query.tableMutations(), mutations);
});

test('authored queries preserve raw member boundaries and retain warm trace identity across query order', () => {
	const f = sourceQuery('local left={input={}}; local right={input={}}; return left.input, right.input');
	const raw = f.written.trace(f.roots[0]), trace = f.query.trace(f.roots[0]);
	assert.equal(raw.terminals.length, 0); assert.equal(raw.boundaries.length, 1); assert.equal(raw.boundaries[0].reason, 'member-read');
	assert.equal(f.written.inputs(f.roots[0]).kind, 'boundary');
	const sources = trace.sources, terminals = trace.terminals, boundaries = trace.boundaries;
	const mutations = f.query.tableMutations(); f.query.trace(f.roots[1]);
	for (let index = 0; index < 100; index++) {
		assert.equal(f.resolver.authoredSources, f.query); assert.equal(f.query.trace(f.roots[0]), trace);
		assert.equal(trace.sources, sources); assert.equal(trace.terminals, terminals); assert.equal(trace.boundaries, boundaries);
		assert.equal(f.query.tableMutations(), mutations); assert.equal(f.written.trace(f.roots[0]), raw);
	}
	assert.equal(raw.terminals.length, 0); assert.equal(raw.boundaries[0].reason, 'member-read');
});

test('new snapshots re-evaluate provider writes without changing retained old source results', () => {
	const consumer = buildLuaFileSemanticData("local definitions=require('library'); return definitions.input", 'consumer.lua');
	const provider = buildLuaFileSemanticData('local definitions={input={}}; return definitions', 'library.lua');
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture([consumer.file, provider.file]));
	workspace.updateFiles([consumer, provider]);
	const before = workspace.getSnapshot(), written = before.symbolResolver.writtenSources, query = before.symbolResolver.authoredSources;
	const returned = consumer.chunk.body.get(1); assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const root = written.expression(consumer, returned.expressions[0]), trace = query.trace(root), mutations = query.tableMutations();
	assert.equal(trace.terminals.length, 1); assert.equal(trace.boundaries.length, 0);
	workspace.updateFile('library.lua', 'local definitions={input={}}; definitions.input={}; return definitions');
	const after = workspace.getSnapshot(), nextFile = after.getFileData('consumer.lua')!, nextWritten = after.symbolResolver.writtenSources;
	const nextReturned = nextFile.chunk.body.get(1); assert.ok(nextReturned.kind === LuaSyntaxKind.ReturnStatement);
	const next = after.symbolResolver.authoredSources.trace(nextWritten.expression(nextFile, nextReturned.expressions[0]));
	assert.equal(next.terminals.length, 2); assert.ok(next.boundaries.some(boundary => boundary.reason === 'competing-writes'));
	assert.notEqual(after.symbolResolver.authoredSources, query); assert.equal(query.trace(root), trace); assert.equal(query.tableMutations(), mutations);
	assert.equal(trace.terminals.length, 1); assert.equal(trace.boundaries.length, 0);
	assert.ok(trace.sources.every(source => source.file !== after.getFileData('library.lua')));
});
