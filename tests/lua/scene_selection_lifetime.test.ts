import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first', options = { pos = { x = 1, y = 2, z = 3 } } },
 { member_id = 'same', definition_id = 'second' },
} })
scenes.register('same', { objects = {} })`;

function fixture(t: TestContext, source = SOURCE, imports: readonly (readonly [string, string])[] = []) {
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, imports), document = f.documents.get(f.model);
	const context = new SceneAuthoringContext(f.model, f.documents, { document, sourceVersion: f.model.version, scene: document.scenes[0] });
	t.after(() => context.dispose());
	return { ...f, context, document };
}

test('Scene selection lifetime advances once for an actual selection change or explicit clear', t => {
	const f = fixture(t), { context, document, model } = f, scene = document.scenes[0];
	const initial = context.selectionRevision, observed: number[] = [];
	t.after(context.onDidChangeSelection(() => { observed.push(context.selectionRevision); }));
	assert.equal(context.select(document, model.version, { kind: 'scene', scene }), true);
	assert.equal(context.selectionRevision, initial + 1);
	assert.equal(context.select(document, model.version, { kind: 'scene', scene }), true);
	assert.equal(context.selectionRevision, initial + 1);
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	assert.equal(context.select(document, model.version, undefined), true);
	assert.equal(context.selectionRevision, initial + 3);
	assert.equal(context.select(document, model.version, undefined), true);
	assert.deepEqual(observed, [initial + 1, initial + 2, initial + 3]);
});

for (const target of ['primary root', 'member'] as const) test(`same-occurrence canonical edits preserve captured ${target} Source authority`, t => {
	const f = fixture(t), { context, model } = f;
	if (target === 'member') {
		const scene = context.subject!;
		assert.equal(context.select(context.document!, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	}
	const intent = context.selectionRevision;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved declaration\n' }]);
	const moved = context.getSourceLocation(); assert.ok(moved !== undefined);
	assert.equal(context.selectionRevision, intent);
	const scene = context.subject!, document = context.document!;
	const position = scene.objects[0]; assert.ok(position.kind === 'object' && position.position !== null);
	model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer, document.analysis.chunk.locations, position.position.x!, 12345)!);
	const edited = context.getSourceLocation(); assert.ok(edited !== undefined);
	assert.equal(context.selectionRevision, intent); assert.equal(edited.modelVersion, model.version);
	const current = context.document!, range = target === 'member'
		? current.analysis.chunk.locations.range(current.scenes[0].objects[0].field.span) : current.scenes[0].range;
	assert.deepEqual(edited.selection, { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
});

for (const edit of ['delete', 'equal-byte replacement'] as const) test(`Source admission discovers ${edit} of its selected member without substituting the surviving primary root`, t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const intent = context.selectionRevision, { start, end } = context.selectionRange;
	let notifications = 0; t.after(context.onDidChangeSelection(() => { notifications++; assert.equal(context.selectionRevision, intent + 1); }));
	if (edit === 'delete') model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, document.analysis.chunk.locations, document.analysis.chunk.tokens, scene.objects[0].field));
	else model.pushEditOperations([{ offset: start, deleteLength: end - start, text: model.buffer.getTextRange(start, end) }]);
	assert.equal(context.getSourceLocation(), undefined);
	assert.equal(context.selectionRevision, intent + 1); assert.equal(notifications, 1);
	assert.equal(context.selection, undefined); assert.equal(context.availability, 'available');
	assert.ok(context.subject === context.document!.scenes[0]);
	const explicitRoot = context.getSourceLocation(); assert.ok(explicitRoot !== undefined);
	assert.equal(explicitRoot.selection!.row, context.subject!.range.start.line - 1);
	model.undo(); context.refresh();
	assert.equal(context.selection, undefined); assert.equal(context.selectionRevision, intent + 1);
	assert.equal(model.buffer.getText(), SOURCE);
});

test('retiring an unselected exact primary declaration revokes captured root Source before permitting a fresh file action', t => {
	const f = fixture(t), { context, model } = f, intent = context.selectionRevision;
	const range = luaSourceRangeToTextRange(model.buffer, context.subject!.range), written = model.buffer.getTextRange(range.start, range.end);
	assert.equal(context.selection, undefined);
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: written }]);
	assert.equal(context.getSourceLocation(), undefined); assert.equal(context.selectionRevision, intent + 1);
	assert.equal(context.availability, 'unavailable'); assert.equal(context.subject, undefined);
	assert.equal(context.document!.scenes.length, 2);
	const explicitFile = context.getSourceLocation(); assert.ok(explicitFile !== undefined);
	assert.ok(explicitFile.model === model); assert.equal(explicitFile.selection, undefined);
	model.undo(); context.refresh();
	assert.equal(context.availability, 'unavailable'); assert.equal(context.selectionRevision, intent + 1);
});

test('provider-only semantic revocation retires selected Source authority once without editing its canonical source', t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = fixture(t, source, [['bridge.lua', "return require('cartlib/world/scene_library')"]]), { context, model, document } = f;
	const scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const intent = context.selectionRevision, version = model.version;
	const resource = f.sources.catalog.resolveResource({ contextId: model.resource.contextId, path: 'bridge.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	assert.equal(context.getSourceLocation(), undefined);
	assert.equal(context.selectionRevision, intent + 1); assert.equal(context.selection, undefined);
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
	const explicitFile = context.getSourceLocation(); assert.ok(explicitFile !== undefined); assert.equal(explicitFile.selection, undefined);
	provider.undo(); context.refresh();
	assert.equal(context.selectionRevision, intent + 1); assert.equal(context.selection, undefined); assert.equal(context.availability, 'unavailable');
});

test('context-owned removal revokes its captured member subject without waiting for a control update', t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const intent = context.selectionRevision;
	assert.equal(context.removeSelectedMember(), true);
	assert.equal(context.selectionRevision, intent + 1); assert.equal(context.selection, undefined);
	assert.equal(context.canRemoveSelectedMember(), false);
	context.refresh(); assert.equal(context.selectionRevision, intent + 1);
});

for (const newer of [false, true]) test(`fresh explicit Scene selection survives its previous target retirement${newer ? ' unless a newer nested request selects another subject' : ''}`, t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const range = { ...context.selectionRange }, written = model.buffer.getTextRange(range.start, range.end);
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: written }]);
	const current = f.documents.get(model), replacement = current.scenes[0];
	if (newer) {
		const release = context.onDidChangeSelection(() => {
			release(); assert.equal(context.select(current, model.version, { kind: 'scene', scene: replacement }), true);
		}); t.after(release);
	}
	assert.equal(context.select(current, model.version, { kind: 'member', scene: replacement, entry: replacement.objects[0], index: 0 }), !newer);
	assert.equal(context.selection!.kind, newer ? 'scene' : 'member');
	assert.ok(context.selection!.scene === replacement);
});

test('capturing a Scene source request is passive and its mapped subject remains current until real semantic retirement', async t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const queries = t.mock.method(f.documents, 'get'), request = context.captureSourceLocation();
	assert.equal(request.isCurrent!(), true); assert.equal(queries.mock.callCount(), 0);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(request.isCurrent!(), true); assert.equal(queries.mock.callCount(), 0);
	const location = await request.readLocation(); assert.ok(location !== undefined); assert.equal(location.modelVersion, model.version);
	assert.equal(request.isCurrent!(), true);
	const { start, end } = context.selectionRange;
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: model.buffer.getTextRange(start, end) }]);
	assert.equal(await request.readLocation(), undefined); assert.equal(request.isCurrent!(), false);
	assert.equal(await request.readLocation(), undefined);
	const explicitRoot = await context.captureSourceLocation().readLocation(); assert.ok(explicitRoot !== undefined);
	assert.equal(explicitRoot.selection!.row, context.subject!.range.start.line - 1);
});

test('a captured Scene Source request cannot borrow a newer explicit selection or survive context disposal', async t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const member = context.captureSourceLocation();
	assert.equal(context.select(document, model.version, { kind: 'scene', scene }), true);
	assert.equal(member.isCurrent!(), false); assert.equal(await member.readLocation(), undefined);
	const root = context.captureSourceLocation(); context.dispose();
	assert.equal(root.isCurrent!(), false); assert.equal(await root.readLocation(), undefined);
});

test('a source location admission callback cannot return the former selection after publishing a newer source subject', t => {
	const f = fixture(t), { context, model, document } = f, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	const read = f.documents.getSourceLocation.bind(f.documents);
	// Exercise the synchronous publication boundary while preserving the real location producer.
	t.mock.method(f.documents, 'getSourceLocation', (model, document, range) => {
		const location = read(model, document, range);
		assert.equal(context.select(document, model.version, undefined), true);
		return location;
	});
	assert.equal(context.getSourceLocation(), undefined); assert.equal(context.selection, undefined);
});
