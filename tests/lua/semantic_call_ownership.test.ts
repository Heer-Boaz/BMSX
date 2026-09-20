import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { getLuaCallHierarchyCallers } from '../../toolchain/ts/lua/semantic/scope_query';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

test('call hierarchy presentation follows named lexical scopes, not execution flow identity', () => {
	const file = buildLuaFileSemanticData([
		'target()',
		'local function outer()',
		'  do target() end',
		'  local function inner() target() end',
		'  return function() do return function() target() end end end',
		'end',
		'return function() target() end',
	].join('\n'), 'callers.lua');
	const callers = getLuaCallHierarchyCallers(file);
	const names = new Map(file.decls.map(decl => [decl.id, decl.name]));
	assert.deepEqual(file.callSites.map(site => names.get(callers.get(site.call)!)),
		[undefined, 'outer', 'inner', 'outer', undefined]);
	assert.equal(getLuaCallHierarchyCallers(file), callers, 'one projection per file generation');
	assert.ok(file.refs.every(ref => !('caller' in ref)), 'raw references do not capture named ancestors');
});

test('anonymous calls follow edited parent attachments while the previous generation stays unchanged', () => {
	const source = 'local function outer()\n' + '-- parser boundary\n'.repeat(80)
		+ 'return function() target() end\nend';
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('owners.lua', source);
	const oldCallers = getLuaCallHierarchyCallers(old);
	const offset = source.indexOf('outer');
	const edited = source.slice(0, offset) + 'renamed_outer' + source.slice(offset + 5);
	const current = workspace.updateFile('owners.lua', edited,
		SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: 5, insertedLength: 13 }]));
	const [oldInner, oldOuter] = old.functionValueFlows;
	const [inner, outer] = current.functionValueFlows;
	assert.equal(inner.expression, oldInner.expression, 'the anonymous syntax is reused');
	assert.notEqual(outer.declaration, oldOuter.declaration);
	const currentCallers = getLuaCallHierarchyCallers(current);
	assert.equal(oldCallers.get(oldInner.calls[0]), oldOuter.declaration);
	assert.equal(currentCallers.get(inner.calls[0]), outer.declaration);
	assert.equal(getLuaCallHierarchyCallers(old), oldCallers);
	assert.equal(oldCallers.get(oldInner.calls[0]), oldOuter.declaration);
	const cold = buildLuaFileSemanticData(edited, 'owners.lua');
	assert.equal(cold.decls.find(decl => decl.id === getLuaCallHierarchyCallers(cold).get(cold.callSites[0].call))!.name,
		current.decls.find(decl => decl.id === currentCallers.get(inner.calls[0]))!.name);
});

test('public incoming hierarchy groups anonymous calls by named owner and module', () => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('hierarchy.lua', [
		'local function target() end',
		'local function outer()',
		'  return function() target() end',
		'end',
		'local callback = outer()',
		'callback()',
		'target()',
	].join('\n'));
	const frontend = buildLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	const target = file.decls.find(decl => decl.name === 'target')!;
	const incoming = frontend.provideIncomingCalls(target.id);
	assert.equal(incoming.length, 2);
	assert.deepEqual(incoming.find(call => call.from.kind === 'symbol')!.fromRanges.map(range => range.start.line), [3]);
	assert.equal(incoming.find(call => call.from.kind === 'symbol')!.from.label, 'outer');
	assert.deepEqual(incoming.find(call => call.from.kind !== 'symbol')!.fromRanges.map(range => range.start.line), [7]);
});
