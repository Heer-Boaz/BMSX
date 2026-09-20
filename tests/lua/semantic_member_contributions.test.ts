import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';

import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { provideLuaHover } from '../../toolchain/ts/lua/semantic/hover';

test('each written member function owns its definition occurrence and function flow', () => {
	const file = buildLuaFileSemanticData('local object = {}\nfunction object.run(first) end\nfunction object.run(second, third) end\nobject.run()', 'members.lua');
	const definitions = file.decls.filter(decl => decl.name === 'run');
	assert.equal(definitions.length, 2);
	assert.notEqual(definitions[0].id, definitions[1].id);
	assert.deepEqual(file.functionValueFlows.map(flow => flow.declaration), definitions.map(decl => decl.id));
	assert.deepEqual(file.memberValues.map(member => member.declId), definitions.map(decl => decl.id));
	const read = file.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
	assert.equal(read.target, undefined, 'binding must not bake an earlier navigation winner into a member read');
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source: file.source, analysis: file }]);
	assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(read), definitions.map(decl => decl.id));
	assert.deepEqual(snapshot.symbolResolver.resolveCallableTargets(file.callSites[0]), definitions.map(decl => decl.id));
});

test('member writes through aliases retain their authored owners instead of sharing an earlier field definition', () => {
	const file = buildLuaFileSemanticData('local original = {}\nlocal alias = original\nfunction original.run(first) end\nfunction alias.run(second) end', 'members.lua');
	const original = file.decls.find(decl => decl.name === 'original')!;
	const alias = file.decls.find(decl => decl.name === 'alias')!;
	assert.equal(file.memberValues.length, 2);
	assert.notEqual(file.memberValues[0].declId, file.memberValues[1].declId);
	assert.deepEqual(file.memberValues.map(member => member.owner.root), [
		{ kind: 'declaration', declId: original.id }, { kind: 'declaration', declId: alias.id },
	]);
});

test('two constructors written to one binding keep separate member definitions', () => {
	const file = buildLuaFileSemanticData('local object = { slot = function(first) end }\nobject = { slot = function(second) end }', 'members.lua');
	const fields = file.decls.filter(decl => decl.name === 'slot');
	assert.equal(fields.length, 2);
	assert.equal(file.memberValues.length, 2);
	assert.notEqual(file.memberValues[0].declId, file.memberValues[1].declId);
	assert.notDeepEqual(file.memberValues[0].owner, file.memberValues[1].owner);
	for (const field of fields) assert.equal(file.declarationValuesByDeclaration.get(field.id)!.length, 1);
});

test('nested local member paths stay local without a prior field navigation witness', () => {
	const file = buildLuaFileSemanticData('local object = {}\nobject.child = {}\nobject.child.run = function(value) end\nobject.child.run()', 'members.lua');
	assert.equal(file.decls.find(decl => decl.name === 'run')!.isGlobal, false);
	assert.ok(file.refs.filter(ref => ref.referenceKind === 'member' && !ref.isWrite).every(ref => ref.target === undefined));
});

test('constructor member values do not cross between repeated assignments to one lexical binding', () => {
	const file = buildLuaFileSemanticData(`local object = { slot = { first = true } }
object = { slot = { second = true } }`, 'constructors.lua');
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source: file.source, analysis: file }]);
	const object = file.decls.find(decl => decl.name === 'object')!;
	const sources = file.declarationValuesByDeclaration.get(object.id)!;
	for (const [index, expected] of ['first', 'second'].entries()) {
		const slot = snapshot.symbolResolver.getMembers(sources[index].source).find(decl => decl.name === 'slot')!;
		assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(slot.id)).map(decl => decl.name), [expected]);
		assert.deepEqual(snapshot.symbolResolver.getWholeProgramMembers(declarationValueSource(slot.id)).map(decl => decl.name), [expected]);
	}
});

test('string-key and dot writes retain separate occurrence values on the same storage path', () => {
	const file = buildLuaFileSemanticData(`local object = {}
object['run'] = function(first) end
object.run = function(second) end
object.run()`, 'string-keys.lua');
	const [first, second] = file.memberValues;
	assert.notEqual(first.declId, second.declId);
	assert.deepEqual(first.owner, second.owner);
	assert.equal(first.name, second.name);
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source: file.source, analysis: file }]);
	assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(file.refs.find(ref => ref.name === 'run' && !ref.isWrite)!), [first.declId, second.declId]);
	assert.deepEqual(snapshot.symbolResolver.resolveWholeProgramCallableTargets(file.callSites[0]), [first.declId, second.declId]);
});

test('adding and removing a sibling member writer recomposes navigation without changing old snapshots', () => {
	const path = 'edit-members.lua';
	const source = 'local object = {}\nfunction object.run(first) end\n'
		+ '-- unchanged reader boundary\n'.repeat(80)
		+ 'local function read() return object.run() end\nreturn read';
	const workspace = new LuaSemanticWorkspace();
	const original = workspace.updateFile(path, source);
	const old = workspace.getSnapshot();
	const read = original.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
	const originalTarget = old.symbolResolver.resolveReferenceTargets(read);
	const offset = source.indexOf('-- unchanged');
	const inserted = 'function object.run(second, third) end\n';
	const changedSource = source.slice(0, offset) + inserted + source.slice(offset);
	for (const [text, change, count] of [
		[changedSource, SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: 0, insertedLength: inserted.length }]), 2],
		[source, SourceChangeMap.unchanged(changedSource.length).append([{ offset, deletedLength: inserted.length, insertedLength: 0 }]), 1],
	] as const) {
		const edited = workspace.updateFile(path, text, change);
		const snapshot = workspace.getSnapshot();
		const cold = buildLuaSemanticWorkspaceSnapshot([{ path, source: text }]);
		const editedRead = edited.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
		assert.equal(snapshot.symbolResolver.resolveReferenceTargets(editedRead).length, count);
		const project = (current: typeof snapshot) => {
			const file = current.getFileData(path)!;
			const read = file.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
			return current.symbolResolver.resolveReferenceTargets(read).map(id => ({
				range: file.chunk.locations.range(current.symbolResolver.getDeclaration(id).span),
				signatures: current.symbolResolver.getFunctionSignatures(id),
			}));
		};
		assert.deepEqual(project(snapshot), project(cold));
		assert.deepEqual(old.symbolResolver.resolveReferenceTargets(read), originalTarget);
		assert.equal(original.memberValues.length, 1);
	}
});

for (const [name, source] of [
	['unbound global', 'function external.run(value) end\nexternal.run()'],
	['unwritten local', 'local object\nobject.run = function(value) end\nobject.run()'],
	['parameter', 'local function install(object)\nobject.run = function(value) end\nobject.run()\nend'],
] as const) {
	test(`exact authored member paths retain navigation without a receiver value: ${name}`, () => {
		const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: 'written-path.lua', source }]);
		const file = snapshot.getFileData('written-path.lua')!;
		const definition = file.decls.find(decl => decl.name === 'run')!;
		const read = file.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
		assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(read), [definition.id]);
		assert.deepEqual(snapshot.symbolResolver.resolveCallableTargets(file.callSites[0]), [definition.id]);
	});
}

test('unknown and dynamic receivers keep written occurrence identity without inventing read targets', () => {
	for (const source of [
		'(left + right).run = function(value) end;\n(other + thing).run()',
		"('text').run = function(value) end;\n('text').run()",
		'objects[key].run = function(value) end\nobjects[key].run()',
	]) {
		const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: 'unknown-path.lua', source }]);
		const file = snapshot.getFileData('unknown-path.lua')!;
		const definition = file.decls.find(decl => decl.name === 'run')!;
		const write = file.refs.find(ref => ref.name === 'run' && ref.isWrite)!;
		const read = file.refs.find(ref => ref.name === 'run' && !ref.isWrite)!;
		assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(write), [definition.id]);
		assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(read), []);
		assert.deepEqual(snapshot.symbolResolver.resolveCallableTargets(file.callSites[0]), []);
	}
});

test('each member identifier has one annotation at its authored definition', () => {
	const file = buildLuaFileSemanticData(`local object = { slot = 1 }
object.slot = 2
function object.run() end
function object:step() end
object['quoted'] = 3`, 'annotations.lua');
	for (const declaration of file.decls.filter(decl => decl.namePath.length > 1)) {
		const facts = file.annotationFacts.filter(fact => fact.span.unit === declaration.span.unit && fact.span.start === declaration.span.start);
		if (declaration.name === 'quoted') assert.deepEqual(facts, []);
		else {
			assert.equal(facts.length, 1, declaration.name);
			assert.equal(facts[0].role, 'definition');
		}
	}
});


test('hover deduplicates written headers without merging navigation definitions', () => {
	for (const [source, expected] of [
		['local object = {}\nobject.field = 1\nobject.field = 2\nreturn object.field', ['(field) object.field']],
		['local object = {}\nfunction object.run(value) end\nfunction object.run(value) end\nfunction object.run(other, extra) end\nreturn object.run', ['(function) object.run(value)', '(function) object.run(other, extra)']],
	] as const) {
		const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: 'hover-members.lua', source }]);
		const file = snapshot.getFileData('hover-members.lua')!;
		const read = file.refs.find(ref => ref.referenceKind === 'member' && !ref.isWrite)!;
		const position = file.chunk.locations.range(read.span).start;
		const targets = snapshot.symbolResolver.resolveReferenceTargets(read);
		assert.equal(targets.length, file.memberValues.length);
		const hover = provideLuaHover(file, snapshot.symbolResolver, new Map(), position.line, position.column)!;
		assert.deepEqual(hover.contents.map(content => content.label), expected);
	}
});
