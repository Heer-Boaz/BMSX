import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import type { LuaProjectModuleBindings } from '../../toolchain/ts/lua/semantic/module_resolution';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';

test('opaque semantic addresses retain separate module exports in each importing namespace', () => {
	const first = buildLuaFileSemanticData('local api = {}; function api.run(first) end; return api', 'context:first\0same.lua');
	const second = buildLuaFileSemanticData('local api = {}; function api.run(second) end; return api', 'context:second\0same.lua');
	const consumerSource = "local api = require('shared')\napi.run()";
	const left = buildLuaFileSemanticData(consumerSource, 'opaque:left');
	const right = buildLuaFileSemanticData(consumerSource, 'opaque:right');
	const leftScope = new Map([['shared', first.file]]), rightScope = new Map([['shared', second.file]]);
	const workspace = new LuaSemanticWorkspace(new Map([[first.file, leftScope], [left.file, leftScope],
		[second.file, rightScope], [right.file, rightScope]]));
	workspace.updateFiles([first, second, left, right]);
	const snapshot = workspace.getSnapshot();
	const frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
	for (const [consumer, provider] of [[left, first], [right, second]]) {
		const reference = consumer.refs.find(ref => ref.name === 'run')!;
		const expected = provider.decls.find(decl => decl.name === 'run')!;
		assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(reference), [expected.id]);
		assert.deepEqual(snapshot.symbolResolver.resolveWholeProgramReferenceTargets(reference), [expected.id]);
		const written = snapshot.symbolResolver.writtenSources;
		assert.deepEqual(written.trace(written.write(consumer.declarationValues[0])).terminals.map(source => source.file), [provider]);
		const navigation = frontend.getFile(consumer.file).findNavigationAt(1, consumerSource.indexOf('shared') + 1)!;
		assert.deepEqual(navigation.targets.map(target => target.range.path), [provider.file]);
	}
});

test('binding-only generations replace queries without rebinding files or mutating retained snapshots', t => {
	const first = buildLuaFileSemanticData('return { first = true }', 'opaque:provider:first');
	const second = buildLuaFileSemanticData('return { second = true }', 'opaque:provider:second');
	const consumer = buildLuaFileSemanticData("return require('shared.lua')", 'opaque:consumer');
	const bindings = (provider: string): LuaProjectModuleBindings => {
		const scope = new Map([['shared.lua', provider], ['shared', provider]]);
		return new Map([first, second, consumer].map(file => [file.file, scope]));
	};
	const workspace = new LuaSemanticWorkspace(bindings(first.file));
	workspace.updateFiles([first, second, consumer]);
	const old = workspace.getSnapshot();
	const query = old.symbolResolver.writtenSources;
	const statement = consumer.chunk.body.get(0)!;
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const returned = query.trace(query.expression(consumer, statement.expressions[0]));
	assert.deepEqual(returned.terminals.map(source => source.file), [first]);
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	assert.equal(workspace.setModuleBindings(bindings(second.file)), true);
	const current = workspace.getSnapshot();
	assert.equal(parse.mock.callCount(), 0);
	assert.notEqual(current, old);
	for (const file of [first, second, consumer]) assert.equal(current.getFileData(file.file), old.getFileData(file.file));
	assert.equal(old.resolveModule(consumer.file, 'shared.lua'), first.file);
	assert.equal(current.resolveModule(consumer.file, 'shared.lua'), second.file);
	assert.equal(old.resolveModule(consumer.file, 'missing'), undefined);
	const currentQuery = current.symbolResolver.writtenSources;
	assert.deepEqual(currentQuery.trace(currentQuery.expression(consumer, statement.expressions[0])).terminals.map(source => source.file), [second]);
	assert.equal(query.trace(query.expression(consumer, statement.expressions[0])), returned);
	assert.equal(buildLuaSemanticFrontendFromSnapshot(old).getFile(consumer.file).findNavigationAt(1, 18)!.targets[0].range.path, first.file);
	assert.equal(buildLuaSemanticFrontendFromSnapshot(current).getFile(consumer.file).findNavigationAt(1, 18)!.targets[0].range.path, second.file);
});
