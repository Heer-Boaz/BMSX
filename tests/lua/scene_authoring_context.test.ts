import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createLuaTableFieldRemovalEdits } from '../../ide/language/lua/source_edits';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'actor', options = { pos = { x = 1, y = 2, z = 3 } } },
 { member_id = 'same', definition_id = 'actor', options = { pos = { x = 4, y = 5, z = 6 } } },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'actor' },
} })`;

function fixture(t: TestContext) {
	const f = createSceneSourceFixture(t, SOURCE);
	const { model, documents } = f;
	const document = documents.get(model), first = new SceneAuthoringContext(model, documents), second = new SceneAuthoringContext(model, documents);
	t.after(() => { first.dispose(); second.dispose(); });
	return { ...f, document, first, second, project: () => documents.get(model) };
}

test('independent authored contexts share a source projection, not semantic selection or presentation lifetime', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	assert.equal(f.first.selection, undefined, 'a domain context does not choose the first visible row');
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	f.second.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	assert.equal(f.first.document, f.second.document);
	assert.notEqual(f.first.selection, f.second.selection);
	assert.notDeepEqual(f.first.selectionRange, f.second.selectionRange);
	assert.deepEqual(f.first.getWorkingCopies(), [f.model]);
	const secondSelection = f.second.selection;
	f.first.dispose();
	assert.equal(f.second.selection, secondSelection);
	assert.equal(f.second.canRemoveSelectedMember(), true);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('authored selection tracks its exact containing declaration and member across canonical edits', t => {
	const f = fixture(t), scene = f.document.scenes[1];
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const prefix = '-- prefix\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	assert.equal(f.first.selection!.kind, 'member', 'admission refreshes surviving source correspondence without a UI frame');
	assert.equal(f.first.canRemoveSelectedMember(), true);
	assert.equal(f.first.select(f.document, f.model.version, { kind: 'scene', scene: f.document.scenes[0] }), false);
	const next = f.project(); f.first.refresh();
	assert.equal(f.first.select(f.document, f.model.version, { kind: 'scene', scene: f.document.scenes[0] }), false,
		'a command captured from an earlier projection cannot select its former AST in the new generation');
	assert.equal(f.first.selection!.scene, next.scenes[1]);
	assert.equal(f.first.selection!.kind, 'member');
	f.first.removeSelectedMember();
	assert.equal(f.first.selection, undefined);
	assert.equal(f.model.buffer.getText(), prefix + SOURCE.replace("{ member_id = 'same', definition_id = 'actor' },", ''),
		'removal preserves the exact other declaration and its same-name members');
	f.model.undo();
	assert.equal(f.model.buffer.getText(), prefix + SOURCE);
	assert.equal(f.first.selection, undefined, 'Undo restores source, not retired member authority');
});

test('context retirement ends source-selection admission without disposing the canonical model', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.first.select(f.document, f.model.version, { kind: 'scene', scene });
	f.first.dispose();
	assert.equal(f.first.refresh(), false);
	assert.equal(f.first.select(f.document, f.model.version, { kind: 'scene', scene }), false);
	assert.equal(f.first.document, undefined);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- alive\n' }]);
	f.model.undo();
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('a complete equal-byte replacement cannot transfer selection to the namesake now at its old position', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const { start, end } = f.first.selectionRange, written = f.model.buffer.getTextRange(start, end);
	f.model.pushEditOperations([{ offset: start, deleteLength: end - start, text: written }]);
	f.first.refresh();
	assert.equal(f.first.selection, undefined);
	assert.equal(f.first.canRemoveSelectedMember(), false);
	f.model.undo(); f.first.refresh();
	assert.equal(f.first.selection, undefined);
	assert.deepEqual(f.first.getWorkingCopies(), [f.model], 'source participation survives selection retirement for Undo/Save');
});

test('context-owned member mutation uses current source and preserves another context over the shared model', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	f.second.select(f.document, f.model.version, { kind: 'scene', scene: f.document.scenes[1] });
	assert.equal(f.first.canMoveSelectedMember(1), true);
	f.first.moveSelectedMember(1);
	const next = f.project(); f.first.refresh(); f.second.refresh();
	const member = f.first.selection!;
	assert.ok(member.kind === 'member');
	assert.equal(member.index, 1);
	assert.equal(f.second.selection!.scene, next.scenes[1]);
	assert.equal(f.second.canMoveSelectedMember(-1), false);
	f.model.undo(); f.first.refresh();
	assert.equal(f.model.buffer.getText(), SOURCE);
	const current = f.first.selection;
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	assert.equal(f.first.canRemoveSelectedMember(), false);
	f.first.removeSelectedMember();
	assert.equal(f.first.selection, current);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('authoring admission observes provider revocation without a consumer edit or UI refresh', t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['bridge.lua', "return require('cartlib/world/scene_library')"]]);
	const context = new SceneAuthoringContext(f.model, f.documents), original = context.document!;
	t.after(() => context.dispose());
	const scene = original.scenes[0];
	assert.equal(context.select(original, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const providerResource = f.sources.catalog.resolveResource({ contextId: f.model.resource.contextId, path: 'bridge.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, providerResource);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	assert.equal(context.canRemoveSelectedMember(), false);
	assert.equal(context.canMoveSelectedMember(1), false);
	assert.equal(context.selection, undefined);
	assert.equal(context.document!.scenes.length, 0);
	assert.equal(context.select(original, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), false);
	assert.equal(context.removeSelectedMember(), false);
	assert.equal(context.moveSelectedMember(1), false);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.model.dirty, false);
});

test('canonical model disposal retires its authored context and never leaves executable source authority', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	f.models.clear();
	assert.equal(f.first.isCurrent, false);
	assert.equal(f.first.document, undefined);
	assert.equal(f.first.selection, undefined);
	assert.equal(f.first.refresh(), false);
	assert.equal(f.first.select(f.document, f.model.version, { kind: 'scene', scene }), false);
	assert.equal(f.first.removeSelectedMember(), false);
	assert.equal(f.first.moveSelectedMember(1), false);
});

test('member removal preserves a newer selection admitted during canonical content publication', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.first.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const release = f.model.onDidChangeContent(() => {
		release();
		const current = f.documents.get(f.model);
		assert.equal(f.first.select(current, f.model.version, { kind: 'scene', scene: current.scenes[1] }), true);
	});
	t.after(release);
	assert.equal(f.first.removeSelectedMember(), true);
	assert.equal(f.first.selection?.kind, 'scene');
	assert.equal(f.first.selection?.scene, f.first.document!.scenes[1]);
	assert.equal(f.model.buffer.getText(), SOURCE.replace(" { member_id = 'same', definition_id = 'actor', options = { pos = { x = 1, y = 2, z = 3 } } },", ' '));
});

for (const change of ['selection', 'source', 'provider'] as const) test(`admission cannot retarget through a newer ${change} change published by selection retirement`, t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['bridge.lua', "return require('cartlib/world/scene_library')"]]);
	const context = new SceneAuthoringContext(f.model, f.documents), original = context.document!, scene = original.scenes[0];
	t.after(() => context.dispose());
	context.select(original, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	const chunk = original.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, scene.objects[0].field));
	let admittedSource = '';
	const release = context.onDidChangeSelection(() => {
		release();
		const current = context.document!, surviving = current.scenes[0];
		context.select(current, f.model.version, { kind: 'member', scene: surviving, entry: surviving.objects[0], index: 0 });
		if (change === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]);
		if (change === 'provider') {
			const resource = f.sources.catalog.resolveResource({ contextId: f.model.resource.contextId, path: 'bridge.lua' })!;
			const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
			provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
		}
		admittedSource = f.model.buffer.getText();
	});
	t.after(release);
	assert.equal(context.removeSelectedMember(), false, 'the older mutation cannot acquire a new target during admission');
	assert.equal(f.model.buffer.getText(), admittedSource, 'notification effects are retained without applying stale source coordinates');
});
