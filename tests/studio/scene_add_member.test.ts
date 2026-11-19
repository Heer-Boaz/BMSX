import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab = require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
prefab.define({def_id='other',class=require('cartlib/world/object_2d')})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d')})
prefab.define({def_id='logic',class=require('cartlib/world/world_object')})
prefab.define({def_id='duplicate',class=require('cartlib/world/object_2d')})
prefab.define({def_id='duplicate',class=require('cartlib/world/object_2d')})`;

function fixture(t: TestContext, objects = '{}', prefabs = PREFABS, prefix = '') {
	const source = prefix + `local scenes = require('cartlib/world/scene_library')
require('prefabs')
scenes.register('same', { objects = ${objects} })
scenes.register('same', { objects = {{member_id='untouched',definition_id='actor'}} })`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', prefabs],
	]);
	const document = f.documents.get(f.model);
	assert.equal(document.analysis.chunk.syntaxError, null, source);
	assert.ok(document.scenes[0], source);
	const context = new SceneAuthoringContext(f.model, f.documents, { document, sourceVersion: f.model.version, scene: document.scenes[0] });
	t.after(() => context.dispose());
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!);
	const select = (index: number) => {
		assert.equal(context.isCurrent, true);
		const scene = context.subject!;
		assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true);
	};
	return { ...f, source, context, provider, select };
}

test('Add appends to only its exact primary declaration as one canonical source edit and one Undo', t => {
	const f = fixture(t, `{ -- header\r\n\t-- existing\r\n\t{member_id='old',definition_id='actor'}; -- inline\r\n\t-- footer\r\n}`);
	const request = f.context.captureAddMember('2d')!; assert.ok(request);
	assert.deepEqual(request.choices.map(choice => choice.id), ['actor', 'other']);
	for (let index = 0; index < 50; index++) assert.equal(f.context.canAddMember('2d'), true);
	assert.equal(f.context.captureAddMember('2d')!.choices, request.choices, 'command presentation borrows generation-cached prefab choices');
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(request.choices[0], -17, 43, 0), true);
	assert.equal(changes, 1); assert.equal(request.isCurrent(), false);
	const inserted = "{ member_id = 'actor', definition_id = 'actor', position = { x = -17, y = 43 } }";
	const after = f.source.replace('\t-- footer\r\n}', '\t' + inserted + ';\r\n\t-- footer\r\n}');
	assert.equal(f.model.buffer.getText(), after, 'comments, old field bytes, sibling separators and the second declaration remain exact');
	assert.equal(f.provider.buffer.getText(), PREFABS);
	assert.deepEqual(f.context.getWorkingCopies(), [f.model]); assert.equal(f.model.dirty, true);
	const selected = f.context.selection!; assert.equal(selected.kind, 'member');
	if (selected.kind !== 'member') throw new Error('expected inserted member');
	assert.equal(selected.index, 1); assert.equal(selected.scene, f.context.subject);
	assert.equal(readLuaSourceRange(f.model.buffer, f.context.document!.analysis.chunk.locations.range(selected.entry.field.span)), inserted);
	assert.equal(f.context.selectedLocalTransform!.family, '2d');
	assert.equal(f.context.selectedLocalTransform!.ox, -17); assert.equal(f.context.selectedLocalTransform!.oy, 43);
	assert.equal(request.apply(request.choices[0], 1, 2, 0), false); assert.equal(changes, 1);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
	assert.equal(f.context.selection, undefined, 'Undo retires the inserted occurrence rather than selecting another member');
	f.model.redo(); assert.equal(f.model.buffer.getText(), after); assert.equal(f.context.selection, undefined);
});

test('Add handles empty inline and commented tables without reconstructing their existing source', t => {
	for (const objects of ['{}', '{   }', '{ --[[header]] }', '{ -- header\n-- footer\n}', "{{member_id='old',definition_id='actor'}}"]) {
		const f = fixture(t, objects), request = f.context.captureAddMember('2d')!;
		assert.equal(request.apply(request.choices[0], 4, -8, 0), true);
		const selected = f.context.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
		assert.equal(stringLiteralValue(selected.entry.memberId), 'actor');
		assert.equal(stringLiteralValue(selected.entry.definitionId), 'actor');
		assert.ok(selected.entry.position?.value.kind === LuaSyntaxKind.TableConstructorExpression);
		assert.equal(f.context.selectedLocalTransform!.ox, 4); assert.equal(f.context.selectedLocalTransform!.oy, -8);
		f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	}
});

test('Add allocates the first fresh prefab-derived identity from all uniquely written member identities', t => {
	const f = fixture(t, `{
 {member_id=existing_id,definition_id='actor'},
 {member_id='actor_2',definition_id='unknown'},
 {member_id='actor_4',definition_id='logic',parent=unknown_parent()},
}`, PREFABS, "local existing_id = 'actor'\n");
	const request = f.context.captureAddMember('2d')!; assert.ok(request);
	assert.equal(request.apply(request.choices[0], 0, 0, 0), true);
	const selection = f.context.selection!; assert.ok(selection.kind === 'member' && selection.entry.kind === 'object');
	assert.equal(stringLiteralValue(selection.entry.memberId), 'actor_3');
	const next = f.context.captureAddMember('2d')!; assert.equal(next.apply(next.choices[0], 5, 6, 0), true);
	const second = f.context.selection!; assert.ok(second.kind === 'member' && second.entry.kind === 'object');
	assert.equal(stringLiteralValue(second.entry.memberId), 'actor_5');
});

test('Add source quotes prefab and member identities through the shared Lua string owner', t => {
	const id = "actor'\\\n☃";
	const f = fixture(t, '{}', `local prefab=require('cartlib/world/prefab')\nprefab.define({def_id="actor'\\\\\\n☃",class=require('cartlib/world/object_2d')})`);
	const request = f.context.captureAddMember('2d')!; assert.equal(request.choices[0].id, id);
	assert.equal(request.apply(request.choices[0], 7, 8, 0), true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(stringLiteralValue(selected.entry.memberId), id); assert.equal(stringLiteralValue(selected.entry.definitionId), id);
});

for (const objects of [
	'{build_member()}',
	"{[1]={member_id='one',definition_id='actor'}}",
	"{{member_id='one'}}",
	"{{member_id=unknown_id(),definition_id='actor'}}",
	"{{member_id='same',definition_id='actor'},{member_id='same',definition_id='actor'}}",
	"{{member_id='one',definition_id='actor',[key()]='unknown'}}",
]) test(`Add refuses incomplete or ambiguously identified objects: ${objects}`, t => {
	const f = fixture(t, objects);
	assert.equal(f.context.canAddMember('2d'), false); assert.equal(f.context.captureAddMember('2d'), undefined);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('Add never chooses a document scene or selected row as an implicit primary subject', t => {
	const f = fixture(t), document = f.context.document!, context = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => context.dispose());
	assert.equal(context.select(document, f.model.version, { kind: 'scene', scene: document.scenes[0] }), true);
	assert.equal(context.canAddMember('2d'), false); assert.equal(context.captureAddMember('2d'), undefined);
});

for (const change of ['source', 'equal-source', 'provider', 'selection', 'read-only', 'dispose', 'model-dispose'] as const)
	test(`captured Add retires on ${change} without writing`, t => {
		const f = fixture(t, "{{member_id='old',definition_id='actor'}}"), request = f.context.captureAddMember('2d')!;
		if (change === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]);
		else if (change === 'equal-source') f.model.pushEditOperations([{ offset: 0, deleteLength: f.source.length, text: f.source }]);
		else if (change === 'provider') f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer dependency\n' }]);
		else if (change === 'selection') f.select(0);
		else if (change === 'read-only') f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
		else if (change === 'dispose') f.context.dispose();
		else f.models.clear();
		const source = f.model.buffer.getText(), version = f.model.version;
		assert.equal(request.isCurrent(), false); assert.equal(request.apply(request.choices[0], 20, 30, 0), false);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	});

test('Add admits a fresh prefab generation and never repairs duplicate or unknown prefab registration', t => {
	const f = fixture(t, '{}', PREFABS.replaceAll("class=require('cartlib/world/object_2d')", "class=unknown_class()"));
	assert.equal(f.context.captureAddMember('2d'), undefined);
	f.provider.pushEditOperations([{ offset: 0, deleteLength: f.provider.buffer.length, text: PREFABS }]);
	const request = f.context.captureAddMember('2d')!; assert.deepEqual(request.choices.map(choice => choice.id), ['actor', 'other']);
	assert.equal(request.apply(request.choices[1], 9, 10, 0), true);
});

test('Add preserves a newer explicit selection published by its canonical source edit', t => {
	const f = fixture(t, "{{member_id='old',definition_id='actor'}}"), request = f.context.captureAddMember('2d')!;
	const release = f.model.onDidChangeContent(() => { release(); f.select(0); }); t.after(release);
	assert.equal(request.apply(request.choices[0], 11, 12, 0), true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(stringLiteralValue(selected.entry.memberId), 'old'); assert.equal(f.context.subject!.objects.length, 2);
});

for (const change of ['source', 'dispose', 'subject-replacement'] as const)
	test(`Add does not select a replacement occurrence after reentrant ${change} publication`, t => {
		const f = fixture(t, '{}'), request = f.context.captureAddMember('2d')!;
		const release = f.model.onDidChangeContent(() => {
			release();
			if (change === 'dispose') f.context.dispose();
			else if (change === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer edit\n' }]);
			else {
				assert.equal(f.context.isCurrent, true);
				const range = luaSourceRangeToTextRange(f.model.buffer, f.context.subject!.range);
				f.model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: f.model.buffer.getTextRange(range.start, range.end) }]);
			}
		}); t.after(release);
		assert.equal(request.apply(request.choices[0], 13, 14, 0), true);
		assert.equal(f.context.selection, undefined);
	});

test('Add does not require a visual, resolved prefab pose or unrelated parent edges', t => {
	const f = fixture(t, "{{member_id='old',definition_id='actor',parent=unknown_parent()}}", PREFABS.replace("def_id='actor',", "def_id='actor',position=unknown_pose(),"));
	const request = f.context.captureAddMember('2d')!; assert.ok(request);
	assert.equal(request.apply(request.choices[0], 32, 48, 0), true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(selected.entry.parent, null); assert.equal(selected.entry.transform, null); assert.equal(selected.entry.options, null);
	assert.equal(selected.entry.rotation, null);
});

test('3D Add writes an explicit world-unit position while retaining the prefab basis and one canonical Undo', t => {
	const prefabs = PREFABS.replace("def_id='mesh',", "def_id='mesh',position={x=100,y=200,z=300},scale={x=2,y=3,z=4},");
	const f = fixture(t, "{{member_id='mesh',definition_id='actor'}}", prefabs);
	assert.equal(f.context.canAddMember('2d'), true); assert.equal(f.context.canAddMember('3d'), true);
	const request = f.context.captureAddMember('3d')!;
	assert.deepEqual(request.choices, [{ id: 'mesh', family: '3d' }]);
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(request.choices[0], 1.25, 0, -3.5), true);
	assert.equal(changes, 1); assert.equal(request.isCurrent(), false);
	// These exact bytes are the writer's canonical-source integrity contract.
	const inserted = "{ member_id = 'mesh_2', definition_id = 'mesh', position = { x = 1.25, y = 0, z = -3.5 } }";
	const written = f.model.buffer.getText(); assert.ok(written.includes(inserted));
	const pose = f.context.selectedLocalTransform; assert.ok(pose?.family === '3d');
	assert.deepEqual([pose.ox, pose.oy, pose.oz, pose.xx, pose.yy, pose.zz], [1.25, 0, -3.5, 2, 3, 4]);
	assert.equal(f.provider.buffer.getText(), prefabs);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.model.redo(); assert.equal(f.model.buffer.getText(), written);
});

test('Add admission addresses the requested prefab family without treating an empty family as another mode', t => {
	const f = fixture(t, '{}', "local p=require('cartlib/world/prefab')\np.define({def_id='mesh',class=require('cartlib/world/object_3d')})");
	assert.equal(f.context.canAddMember('2d'), false); assert.equal(f.context.captureAddMember('2d'), undefined);
	assert.equal(f.context.canAddMember('3d'), true); assert.equal(f.context.captureAddMember('3d')!.choices[0].id, 'mesh');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});
