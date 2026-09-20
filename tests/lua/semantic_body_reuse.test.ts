import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { semanticAnswers, semanticSnapshot } from './semantic_test_harness';

const padding = 'do end\n'.repeat(80);
const body = 'local value = item.field\n'.repeat(80);

function edit(workspace: LuaSemanticWorkspace, offset: number, deletedLength: number, inserted: string) {
	const old = workspace.getFileData('reuse.lua')!;
	const source = old.source.slice(0, offset) + inserted + old.source.slice(offset + deletedLength);
	const updated = workspace.updateFile(old.file, source, SourceChangeMap.unchanged(old.source.length)
		.append([{ offset, deletedLength, insertedLength: inserted.length }]));
	assert.deepEqual(semanticAnswers(workspace.getSnapshot()), semanticAnswers(semanticSnapshot(buildLuaFileSemanticData(source, old.file))));
	return updated;
}

test('body edits skip unchanged sibling subtrees and retain their finished facts', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = { field = 1 }\n${padding}local function changed()\n${body}return item end\n`
		+ `local function retained()\n${body}return function() return item.field end end\nreturn retained()`;
	const old = workspace.updateFile('reuse.lua', source);
	const snapshot = workspace.getSnapshot();
	const answers = semanticAnswers(snapshot);
	const retained = old.functionValueFlows.find(flow => old.decls.find(decl => decl.id === flow.declaration)?.name === 'retained')!;
	const changedOffset = source.indexOf('local value');
	const current = edit(workspace, changedOffset, 0, 'do end; ');
	assert.equal(current.bindingWork.boundFunctions, 1);
	assert.equal(current.bindingWork.reusedFunctions, 2);
	assert.equal(current.functionValueFlows.find(flow => flow.id === retained.id), retained);
	assert.ok(current.bindingWork.visitedExpressions < old.bindingWork.visitedExpressions * 0.6);
	for (const reference of old.refs.filter(ref => old.chunk.locations.offset(ref.span.unit, ref.span.start) > source.indexOf('local function retained')
		&& old.chunk.locations.offset(ref.span.unit, ref.span.start) < old.chunk.locations.offset(retained.expression.span.unit, retained.expression.span.end))) {
		assert.ok(current.refs.includes(reference), 'unchanged subtree references are retained, not rebound');
	}
	const write = current.declarationValues.find(value => value.declId === retained.declaration)!;
	assert.equal(write.source, retained.functionValue, 'parent value producer consumes the retained body identity');
	assert.deepEqual(semanticAnswers(snapshot), answers);
	const undone = edit(workspace, changedOffset, 'do end; '.length, '');
	assert.equal(undone.bindingWork.reusedFunctions, 2);
	assert.deepEqual(semanticAnswers(snapshot), answers);
});

test('leading edits reattach file scopes without visiting retained bodies', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = {}\n${padding}function item:read()\n${body}published = self; return self end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const snapshot = workspace.getSnapshot();
	const answers = semanticAnswers(snapshot);
	const current = edit(workspace, 0, 0, '-- inserted\n');
	assert.notEqual(old.scopes[0].id, current.scopes[0].id);
	assert.equal(current.bindingWork.boundFunctions, 0);
	assert.equal(current.bindingWork.reusedFunctions, 1);
	const publication = current.decls.find(decl => decl.name === 'published')!;
	assert.equal(publication.scope, current.scopes[0].id);
	assert.equal(old.decls.find(decl => decl.name === 'published')!.scope, old.scopes[0].id);
	assert.deepEqual(semanticAnswers(snapshot), answers);
});

for (const name of ['future', 'item']) test(`consumed lexical ${name === 'future' ? 'misses' : 'bindings'} invalidate even through nested functions`, () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = { field = 1 }\n${padding}local function retained()\n${padding}return function() return ${name}.field end end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const expression = old.functionValueFlows[1].expression;
	const insertion = `local ${name} = { field = 2 }\n`;
	const offset = source.indexOf('do end');
	const current = edit(workspace, offset, 0, insertion);
	assert.equal(current.functionValueFlows[1].expression, expression, 'syntax survives but its lexical input changes');
	assert.equal(current.bindingWork.boundFunctions, 2);
	assert.equal(current.bindingWork.reusedFunctions, 0);
	edit(workspace, offset, insertion.length, '');
});

test('unconsumed local insertions do not invalidate retained bodies', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = { field = 1 }\n${padding}local function retained()\n${body}return item end\n${padding}`;
	workspace.updateFile('reuse.lua', source);
	const current = edit(workspace, source.indexOf('do end') + 40 * 'do end\n'.length, 0, 'local unrelated = 2\n');
	assert.equal(current.bindingWork.boundFunctions, 0);
	assert.equal(current.bindingWork.reusedFunctions, 1);
});

test('reused raw bodies receive current builtin projections and preserve prior snapshots', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local function retained()\n${padding}return setmetatable({}, {}) end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	assert.equal(old.functionValueFlows[0].assignments.length, 3);
	const current = edit(workspace, source.length, 0, 'setmetatable = replacement\n');
	assert.equal(current.bindingWork.reusedFunctions, 1);
	assert.equal(current.functionValueFlows[0].assignments.length, 0);
	assert.equal(old.functionValueFlows[0].assignments.length, 3);
});

test('independent cold syntax generations and different file owners cannot share cached facts', () => {
	const source = `local function retained()\n${padding}return missing end`;
	const first = buildLuaFileSemanticData(source, 'first.lua');
	const cold = buildLuaFileSemanticData(source, 'first.lua');
	const other = buildLuaFileSemanticData(source, 'second.lua', undefined, first.chunk);
	assert.equal(cold.bindingWork.reusedFunctions, 0);
	assert.equal(other.bindingWork.reusedFunctions, 0);
	assert.notEqual(first.functionValueFlows[0], cold.functionValueFlows[0]);
	assert.ok(other.decls.every(decl => decl.file === 'second.lua'));
});

test('cached lexical writes keep their enclosing storage and body-owned flow', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = {}\n${padding}local function write(input)\n${padding}item = input; item.field = input end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const priorWrites = old.declarationValues.filter(write => write.flow !== undefined);
	const current = edit(workspace, source.length, 0, 'local unrelated = 1\n');
	assert.equal(current.bindingWork.reusedFunctions, 1);
	for (const write of priorWrites) assert.ok(current.declarationValues.includes(write));
	assert.equal(current.functionValueFlows[0], old.functionValueFlows[0]);
	assert.equal(current.globalStorageDecls.length, 0);
});

test('loop-bound closures retain unknown numeric reads and nested lexical facts', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = {}\nfor index = 1, 3 do\n${padding}local function read()\n${body}return index end\n${padding}end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	assert.equal(old.functionValueFlows[0].returns[0].firstValue.root.kind, 'unknown');
	const current = edit(workspace, source.length, 0, 'local unrelated = 1\n');
	assert.equal(current.bindingWork.reusedFunctions, 1);
	assert.equal(current.functionValueFlows[0], old.functionValueFlows[0]);
	assert.equal(current.functionValueFlows[0].returns[0].firstValue.root.kind, 'unknown');
});

test('recursive const closures and explicit self parameters preserve lexical activation', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = {}\n${padding}local recur<const> = function(self)\n${padding}return recur(self) end\nfunction item.read(self)\n${body}return self end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const current = edit(workspace, source.length, 0, 'do end\n');
	assert.equal(current.bindingWork.reusedFunctions, 2);
	assert.equal(current.functionValueFlows[0], old.functionValueFlows[0]);
	assert.equal(current.functionValueFlows[1], old.functionValueFlows[1]);
});

test('editing an outer body reuses nested bodies without retaining their previous parent attachment', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local item = { field = 1 }\n${padding}local function outer()\n${padding}local function inner()\n${body}return item.field end\n${padding}return inner end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const inner = old.functionValueFlows[0];
	const outer = old.functionValueFlows[1];
	const before = semanticAnswers(workspace.getSnapshot());
	const offset = source.indexOf('local function outer()') + 'local function outer()\n'.length + 20 * 'do end\n'.length;
	const current = edit(workspace, offset, 0, 'do end; ');
	assert.equal(current.bindingWork.boundFunctions, 1);
	assert.equal(current.bindingWork.reusedFunctions, 1);
	assert.equal(current.functionValueFlows[0], inner);
	assert.notEqual(current.functionValueFlows[1].id, outer.id);
	assert.equal(current.scopeParents.get(inner.id), current.functionValueFlows[1].id);
	assert.equal(old.scopeParents.get(inner.id), outer.id);
	assert.deepEqual(semanticAnswers(semanticSnapshot(old)), before);
});

test('cached descendants propagate lexical misses through every retained ancestor', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `${padding}local function outer()\n${padding}return function()\n${padding}return function() return future.field end end end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	// First rebind outer while retaining its child: validation itself must
	// register the child's transitive miss as an input of this new outer.
	const offset = source.indexOf('local function outer()') + 'local function outer()\n'.length + 20 * 'do end\n'.length;
	const middle = edit(workspace, offset, 0, 'do end; ');
	assert.equal(middle.bindingWork.boundFunctions, 1);
	assert.equal(middle.bindingWork.reusedFunctions, 2);
	assert.equal(middle.functionValueFlows[0], old.functionValueFlows[0]);
	const current = edit(workspace, 0, 0, 'local future = { field = 1 }\n');
	assert.equal(current.bindingWork.boundFunctions, 3);
	assert.equal(current.bindingWork.reusedFunctions, 0);
});

test('nested raw builtin sites compose using writes outside a reused outer contribution', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `${padding}local function outer()\n${padding}return function() return setmetatable({}, {}) end end\n${padding}`;
	const old = workspace.updateFile('reuse.lua', source);
	const current = edit(workspace, source.length, 0, 'setmetatable = custom\n');
	assert.equal(current.bindingWork.reusedFunctions, 2);
	assert.equal(current.functionValueFlows[0].assignments.length, 0);
	assert.equal(old.functionValueFlows[0].assignments.length, 3);
});

test('moving retained locals into a nested block invalidates captured member scopes', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `do\n${padding}${padding}local item = {}\n${padding}local function inner() item.field = 1 end\n${padding}end`;
	const old = workspace.updateFile('reuse.lua', source);
	const offset = 3 + padding.length;
	const end = source.lastIndexOf('end');
	const updated = source.slice(0, offset) + 'do\n' + source.slice(offset, end) + 'end\n' + source.slice(end);
	const current = workspace.updateFile('reuse.lua', updated, SourceChangeMap.unchanged(source.length).append([
		{ offset, deletedLength: 0, insertedLength: 3 },
		{ offset: end + 3, deletedLength: 0, insertedLength: 4 },
	]));
	assert.deepEqual(semanticAnswers(workspace.getSnapshot()), semanticAnswers(semanticSnapshot(buildLuaFileSemanticData(updated, 'reuse.lua'))));
	assert.equal(current.functionValueFlows[0].expression, old.functionValueFlows[0].expression, 'the function syntax survives the move');
	assert.equal(current.decls.find(decl => decl.name === 'item')!.id, old.decls.find(decl => decl.name === 'item')!.id);
	assert.equal(current.bindingWork.boundFunctions, 1);
	assert.equal(current.decls.find(decl => decl.name === 'field')!.scope, current.decls.find(decl => decl.name === 'item')!.scope);
});

test('nested member publications invalidate when their external lexical scope changes', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = `local function outer()\n${padding}local item = {}\nlocal function middle()\nlocal function inner() item.field = 1 end\nreturn inner end\nreturn middle end`;
	const old = workspace.updateFile('reuse.lua', source);
	const current = edit(workspace, source.indexOf('do end'), 0, 'do end; ');
	assert.equal(current.bindingWork.boundFunctions, 3);
	assert.equal(current.bindingWork.reusedFunctions, 0);
	const field = current.decls.find(decl => decl.name === 'field')!;
	assert.notEqual(field.scope, old.decls.find(decl => decl.name === 'field')!.scope);
});
