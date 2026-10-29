import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { ScenePrimaryBookmark } from '../../ide/workbench/contrib/scene_editor/primary_bookmark';
import { captureScenePrimary } from '../../ide/workbench/contrib/scene_editor/primary_snapshot';
import { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { getTextSnapshotFingerprint } from '../../ide/editor/text/source_text';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SceneEditorController } from '../../ide/workbench/contrib/scene_editor/controller';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorInputSerializer, type SerializedSceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_serializer';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first' },
 { member_id = 'same', definition_id = 'second' },
} })
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'other' },
} })`;

function fixture(t: TestContext, source = SOURCE, imports: readonly (readonly [string, string])[] = []) {
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, imports);
	const document = f.documents.get(f.model);
	const context = new SceneAuthoringContext(f.model, f.documents, { document, sourceVersion: f.model.version, scene: document.scenes[0] });
	const view = new SceneEditorViewState(context); view.refresh(); selectSceneOutlineRow(view.hierarchy, 1);
	t.after(() => { view.dispose(); context.dispose(); });
	const bookmark = () => {
		const location = new ScenePrimaryBookmark(context, view); t.after(() => location.dispose()); return location;
	};
	return { ...f, document, context, view, bookmark };
}

test('primary snapshots keep declaration identity independently from a cleared member selection', t => {
	const f = fixture(t), reference = f.context.captureSourceReference();
	f.context.select(f.document, f.model.version, undefined); f.view.refresh();
	const snapshot = captureScenePrimary(f.view);
	assert.equal(snapshot.view.selected, undefined);
	assert.equal(snapshot.subject.availability, 'available');
	assert.deepEqual(snapshot.subject.range, reference.subject!.range);
	assert.deepEqual(snapshot.source, reference.source);
	assert.notEqual(snapshot.subject.range, reference.subject!.range, 'snapshot mutation cannot change another captured source reference');
	assert.deepEqual(snapshot.source.fingerprint, getTextSnapshotFingerprint(f.model.buffer));
});

test('primary capture observes a newer domain selection published by semantic retirement', t => {
	const f = fixture(t); f.view.section = 'details';
	let selected = false;
	const release = f.context.onDidChangeSelection(() => {
		if (selected || f.context.selection !== undefined) return;
		selected = true;
		assert.equal(f.context.select(f.context.document!, f.model.version, { kind: 'scene', scene: f.context.subject! }), true);
	}); t.after(release);
	const chunk = f.document.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, f.document.scenes[0].objects[0].field));
	f.view.refresh();
	const snapshot = captureScenePrimary(f.view);
	assert.equal(selected, true);
	assert.equal(f.context.selection?.kind, 'scene');
	assert.equal(snapshot.view.selected?.kind, 'scene');
	assert.deepEqual(snapshot.view.selected?.root, snapshot.subject.range);
	assert.deepEqual(snapshot.view.selected?.span, snapshot.subject.range);
	assert.deepEqual(snapshot.source.fingerprint, getTextSnapshotFingerprint(f.model.buffer));
});

test('explicit domain refresh publishes reentrant selection and source edits before an observational snapshot', t => {
	const f = fixture(t);
	let changed = false;
	const release = f.context.onDidChangeSelection(() => {
		if (changed) return;
		changed = true;
		const document = f.context.document!, scene = f.context.subject!;
		assert.equal(f.context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- reentrant source edit\n' }]);
	}); t.after(release);
	const chunk = f.document.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, f.document.scenes[0].objects[0].field));
	f.context.refresh();
	const snapshot = captureScenePrimary(f.view), document = f.documents.get(f.model), scene = document.scenes[0];
	assert.equal(changed, true);
	assert.equal(snapshot.view.selected?.kind, 'member');
	assert.deepEqual(snapshot.subject.range, luaSourceRangeToTextRange(f.model.buffer, scene.range));
	assert.deepEqual(snapshot.view.selected?.root, snapshot.subject.range);
	assert.deepEqual(snapshot.view.selected?.span, luaSourceRangeToTextRange(f.model.buffer, document.analysis.chunk.locations.range(scene.objects[0].field.span)));
	assert.deepEqual(snapshot.source.fingerprint, getTextSnapshotFingerprint(f.model.buffer));
});

test('primary serialization observes current mapped source without refreshing stale presentation or publishing selection', t => {
	const f = fixture(t), before = captureScenePrimary(f.view);
	let notifications = 0;
	const release = f.context.onDidChangeSelection(() => {
		notifications++;
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- must not be published by capture\n' }]);
	}); t.after(release);
	const chunk = f.document.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, f.document.scenes[0].objects[0].field));
	const prefix = '-- mapped before semantic refresh\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const version = f.model.version, source = f.model.buffer.getText();
	const query = t.mock.method(f.documents, 'get', () => assert.fail('serialization must not query semantic projections'));
	const snapshot = captureScenePrimary(f.view);
	query.mock.restore();
	assert.equal(notifications, 0);
	assert.equal(f.model.version, version);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(snapshot.view.selected, undefined, 'the mapped retired member cannot inherit a stale projected row');
	assert.equal(snapshot.subject.availability, 'available');
	assert.equal(snapshot.subject.range.start, before.subject.range.start + prefix.length);
	assert.deepEqual(snapshot.source.fingerprint, getTextSnapshotFingerprint(f.model.buffer));
});

test('document serialization observes current mapped source without resolving or publishing a retired selection', t => {
	const f = fixture(t), input = new SceneEditorInput(f.model, f.documents); t.after(() => input.dispose());
	input.view.refresh(); selectSceneOutlineRow(input.view.hierarchy, 1);
	const context = input.view.authoring;
	let notifications = 0;
	const release = context.onDidChangeSelection(() => {
		notifications++;
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- must not be published by serialization\n' }]);
	}); t.after(release);
	const chunk = f.document.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, f.document.scenes[0].objects[0].field));
	const version = f.model.version, source = f.model.buffer.getText();
	const serializer = new SceneEditorInputSerializer(f.sources.catalog, new SceneEditorController(f.sources.catalog, f.documents));
	const query = t.mock.method(f.documents, 'get', () => assert.fail('serialization must not query semantic projections'));
	const snapshot: SerializedSceneEditorInput = JSON.parse(serializer.serialize(input));
	query.mock.restore();
	assert.equal(notifications, 0);
	assert.equal(f.model.version, version);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(snapshot.view.selected, undefined, 'serialization observes the collapsed selection without publishing its retirement');
	assert.deepEqual(snapshot.source.fingerprint, getTextSnapshotFingerprint(f.model.buffer));
});

test('unavailable primary snapshot preserves the original exact inert reference rather than its collapsed marker', t => {
	const f = fixture(t), initial = f.context.captureSourceReference();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- tracked movement\n' }]);
	const moved = f.context.captureSourceReference();
	assert.equal(moved.subject!.range.start, initial.subject!.range.start + '-- tracked movement\n'.length);
	assert.notDeepEqual(moved.source.fingerprint, initial.source.fingerprint);
	const range = moved.subject!.range;
	f.model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start,
		text: f.model.buffer.getTextRange(range.start, range.end) }]);
	const snapshot = captureScenePrimary(f.view);
	assert.equal(snapshot.subject.availability, 'unavailable');
	assert.deepEqual(snapshot.source, initial.source);
	assert.deepEqual(snapshot.subject.range, initial.subject!.range);
	assert.equal(snapshot.view.selected, undefined);
	f.model.undo();
	assert.equal(captureScenePrimary(f.view).subject.availability, 'unavailable');
});

test('a live primary bookmark outlives its old controls/context and resolves the exact current declaration', t => {
	const f = fixture(t), location = f.bookmark();
	f.view.dispose(); f.context.dispose();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	const subject = location.resolve(f.documents)!;
	assert.equal(location.isDisposed, false);
	assert.equal(subject.document, f.documents.get(f.model));
	assert.equal(subject.scene, subject.document.scenes[0]);
	assert.equal(subject.sourceVersion, f.model.version);
	assert.equal(location.model, f.model);
	const selected = location.view.selected!;
	assert.ok(selected.kind === 'member');
	assert.deepEqual(selected.root, luaSourceRangeToTextRange(f.model.buffer, subject.scene.range));
	assert.deepEqual(selected.span, luaSourceRangeToTextRange(f.model.buffer,
		subject.document.analysis.chunk.locations.range(subject.scene.objects[0].field.span)));
	assert.equal(f.model.dirty, true);
});

test('primary and member bookmark spans map before an earlier content observer can re-enter navigation', t => {
	const f = fixture(t);
	let location: ScenePrimaryBookmark;
	let observed = false;
	const release = f.model.onDidChangeContent(() => {
		const subject = location.resolve(f.documents)!;
		assert.equal(subject.scene, subject.document.scenes[0]);
		assert.deepEqual(location.view.selected!.root, luaSourceRangeToTextRange(f.model.buffer, subject.scene.range));
		observed = true;
	}); t.after(release);
	location = f.bookmark();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pre-publication mapping\n' }]);
	assert.equal(observed, true);
	assert.equal(location.isDisposed, false);
});

test('deleting or replacing the exact primary declaration retires navigation once and Undo cannot revive it', t => {
	const f = fixture(t), location = f.bookmark(), reference = f.context.captureSourceReference().subject!;
	let retired = 0; location.onDidRetire(() => retired++);
	f.model.pushEditOperations([{ offset: reference.range.start, deleteLength: reference.range.end - reference.range.start,
		text: f.model.buffer.getTextRange(reference.range.start, reference.range.end) }]);
	assert.equal(location.isDisposed, true);
	assert.equal(retired, 1);
	assert.equal(location.resolve(f.documents), undefined);
	f.model.undo();
	assert.equal(location.resolve(f.documents), undefined);
	assert.equal(retired, 1);
	assert.equal(f.documents.get(f.model).scenes.length, 2, 'same-named declarations still exist but own no retired bookmark');
});

test('member removal clears only bookmarked sub-selection and leaves its authored subject navigable', t => {
	const f = fixture(t), location = f.bookmark(), scene = f.document.scenes[0], chunk = f.document.analysis.chunk;
	f.model.pushEditOperations(createLuaTableFieldRemovalEdits(f.model.buffer, chunk.locations, chunk.tokens, scene.objects[0].field));
	assert.equal(location.isDisposed, false);
	assert.equal(location.view.selected, undefined);
	assert.equal(location.resolve(f.documents)!.scene, f.documents.get(f.model).scenes[0]);
	f.model.undo();
	assert.equal(location.view.selected, undefined, 'restoring source does not select a new member for the old bookmark');
});

test('bookmark matching identifies source subjects and selection, not reading sections or scroll', t => {
	const f = fixture(t), first = f.bookmark();
	f.view.section = 'details'; f.view.hierarchy.position = 23; f.view.details.position = 51;
	const same = f.bookmark();
	assert.equal(first.matches(same), true);
	selectSceneOutlineRow(f.view.hierarchy, 2);
	const otherMember = f.bookmark();
	assert.equal(first.matches(otherMember), false);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(first.matches(same), true);
	assert.equal(first.matches(otherMember), false);
	f.models.clear();
	assert.equal(first.matches(same), false, 'different tombstones must not coalesce at their collapsed offsets');
});

test('provider revocation retires the bookmarked semantic declaration despite unchanged local source', t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = fixture(t, source, [['bridge.lua', "return require('cartlib/world/scene_library')"]]), location = f.bookmark();
	const resource = f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'bridge.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	assert.equal(location.resolve(f.documents), undefined);
	assert.equal(location.isDisposed, true);
	assert.equal(f.model.buffer.getText(), source);
	provider.undo();
	assert.equal(location.resolve(f.documents), undefined);
});

test('capturing an already unavailable primary or disposing its model produces no revivable navigation authority', t => {
	const f = fixture(t), location = f.bookmark();
	let retired = 0; location.onDidRetire(() => retired++);
	f.models.clear();
	assert.equal(location.isDisposed, true); assert.equal(retired, 1);
	location.dispose(); assert.equal(retired, 1);
	const retiredCapture = new ScenePrimaryBookmark(f.context, f.view);
	t.after(() => retiredCapture.dispose());
	assert.equal(retiredCapture.isDisposed, true);
	assert.equal(retiredCapture.resolve(f.documents), undefined);
	let immediate = false; retiredCapture.onDidRetire(() => { immediate = true; });
	assert.equal(immediate, true);
});
