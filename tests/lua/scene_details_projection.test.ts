import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsProjection } from '../../ide/workbench/contrib/scene_editor/details_projection';
import { SceneHierarchyViewState } from '../../ide/workbench/contrib/scene_editor/hierarchy_view';
import { createLuaTableFieldNumberEdits } from '../../ide/language/lua/source_edits';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('first', { objects = {
 { member_id = 'same', definition_id = 'actor.first', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 11, -2, 3 } }, options = {
   enabled = true, title = 'Keep Exact Case',
   nested = { amount = evaluate_amount() }, message = [[line one
line two]],
 } },
 { member_id = 'same', definition_id = 'actor.second' },
 build_member(),
} })
scenes.register('first', { objects = {} })`;

function fixture(t: TestContext, source = SOURCE, imports: readonly (readonly [string, string])[] = []) {
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, imports), document = f.documents.get(f.model);
	const authoring = new SceneAuthoringContext(f.model, f.documents, { document, sourceVersion: f.model.version, scene: document.scenes[0] });
	t.after(() => authoring.dispose());
	return { ...f, document, authoring, projection: new SceneDetailsProjection(authoring) };
}

test('Details projects the exact semantic member with no hierarchy, view or control construction', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	assert.equal(f.projection.refresh(), true); assert.equal(f.projection.subject, undefined);
	assert.equal(f.authoring.selection, undefined, 'constructing Details does not select the first hierarchy row');
	assert.equal(f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	assert.equal(f.projection.refresh(), true);
	const subject = f.projection.subject!;
	assert.ok(subject.selection === f.authoring.selection && subject.document === f.document);
	assert.equal(subject.selection.kind, 'member'); assert.equal(subject.resolution, 'partial');
	assert.equal(subject.label, 'same'); assert.equal(subject.detail, 'actor.first');
	assert.equal(subject.preserveLabelCase, true); assert.equal(subject.preserveDetailCase, true);
	assert.deepEqual(subject.properties.map(property => [property.axis, property.value, property.sourceText]), [['x', 11, '11'], ['y', -2, '-2'], ['z', 3, '3']]);
	const member = scene.objects[0]; assert.ok(member.kind === 'object' && member.spatial !== null);
	assert.ok(subject.properties[0].field === member.spatial!.origin[0]);
	const title = subject.optionProperties.find(property => property.label === 'title')!;
	assert.equal(title.sourceText, "'Keep Exact Case'"); assert.equal(title.editable, true);
	const amount = subject.optionProperties.find(property => property.label === 'nested.amount')!;
	assert.equal(amount.sourceText, 'evaluate_amount()'); assert.equal(amount.editable, true);
	const message = subject.optionProperties.find(property => property.label === 'message')!;
	assert.equal(message.sourceText, '[[line one\nline two]]'); assert.equal(message.editable, false);
	assert.equal(subject.optionProperties.some(property => property.label.startsWith('pos.')), false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

test('unchanged Details refresh reuses the admitted descriptors without reading source ranges again', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const subject = f.projection.subject!, revision = f.projection.revision;
	// Cache performance is a producer contract: clean frames do not reconstruct source properties.
	const reads = t.mock.method(f.model.buffer, 'getTextRange');
	for (let frame = 0; frame < 100; frame++) {
		assert.equal(f.projection.refresh(), false); assert.ok(f.projection.subject === subject);
		assert.ok(f.projection.subject!.properties === subject.properties && f.projection.subject!.optionProperties === subject.optionProperties);
	}
	assert.equal(f.projection.revision, revision); assert.equal(reads.mock.callCount(), 0);
});

test('hierarchy disclosure or presentation disposal cannot withdraw the semantic subject from Details', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const subject = f.projection.subject!, hierarchy = new SceneHierarchyViewState(f.authoring); hierarchy.refresh();
	assert.equal(setWorkbenchTreeCollapsed(hierarchy.outline, 0, true), true);
	assert.equal(hierarchy.outline.rows.some(row => row.element.kind === 'member'), false);
	assert.equal(f.projection.refresh(), false); assert.ok(f.projection.subject === subject);
	hierarchy.dispose();
	assert.equal(f.projection.refresh(), false); assert.ok(f.projection.subject === subject && f.authoring.selection === subject.selection);
});

test('Details follows its own context selection, not another source view or a same-named occurrence', t => {
	const f = fixture(t), scene = f.document.scenes[0], sibling = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => sibling.dispose());
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const first = f.projection.subject!;
	sibling.select(f.document, f.model.version, { kind: 'scene', scene: f.document.scenes[1] });
	assert.equal(f.projection.refresh(), false); assert.ok(f.projection.subject === first);
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	assert.equal(f.projection.refresh(), true); assert.equal(f.projection.subject!.detail, 'actor.second');
	assert.ok(f.projection.subject!.selection.kind === 'member' && f.projection.subject!.selection.entry === scene.objects[1]);
	assert.equal(f.projection.subject!.properties.length, 0);
	assert.equal(f.projection.subject!.optionProperties.length, 0);
});

test('same-occurrence source edits replace Details source descriptors while retaining semantic selection lifetime', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const before = f.projection.subject!, selectionRevision = f.authoring.selectionRevision;
	const property = before.properties[0];
	f.model.pushEditOperations(createLuaTableFieldNumberEdits(f.model.buffer, before.document.analysis.chunk.locations, property.field!, 12345)!);
	assert.equal(f.projection.refresh(), true);
	const after = f.projection.subject!;
	assert.ok(after !== before && after.document === f.documents.get(f.model));
	assert.equal(after.sourceVersion, f.model.version); assert.equal(after.properties[0].value, 12345); assert.equal(after.properties[0].sourceText, '12345');
	assert.equal(f.authoring.selectionRevision, selectionRevision); assert.equal(after.detail, before.detail);
});

test('Details can project a Scene root or dynamic member directly without building rows or inventing editable source', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'scene', scene }); f.projection.refresh();
	const root = f.projection.subject!;
	assert.equal(root.selection.kind, 'scene'); assert.equal(root.label, 'first'); assert.equal(root.resolution, scene.resolution);
	assert.equal(root.properties.length, 0); assert.equal(root.optionProperties.length, 0);
	const dynamic = scene.objects[2]; assert.equal(dynamic.kind, 'dynamic');
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: dynamic, index: 2 }); f.projection.refresh();
	const member = f.projection.subject!;
	assert.ok(member.selection.kind === 'member' && member.selection.entry === dynamic);
	assert.equal(member.properties.length, 0);
	assert.equal(member.optionProperties.length, 0); assert.equal(f.model.dirty, false);
});

test('equal-byte replacement retires Details rather than adopting the duplicate member or its surviving primary root', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const { start, end } = f.authoring.selectionRange;
	f.model.pushEditOperations([{ offset: start, deleteLength: end - start, text: f.model.buffer.getTextRange(start, end) }]);
	assert.equal(f.projection.refresh(), true); assert.equal(f.projection.subject, undefined);
	assert.equal(f.authoring.availability, 'available'); assert.equal(f.authoring.selection, undefined);
	assert.equal(f.projection.refresh(), false);
	f.model.undo(); f.projection.refresh();
	assert.equal(f.projection.subject, undefined); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('provider-only retirement clears Details without a selected-file edit or hierarchy refresh', t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = fixture(t, source, [['bridge.lua', "return require('cartlib/world/scene_library')"]]), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }); f.projection.refresh();
	const version = f.model.version;
	const resource = f.sources.catalog.resolveResource({ contextId: f.model.resource.contextId, path: 'bridge.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	assert.equal(f.projection.refresh(), true); assert.equal(f.projection.subject, undefined);
	assert.equal(f.authoring.availability, 'unavailable'); assert.equal(f.model.version, version); assert.equal(f.model.dirty, false);
	provider.undo(); f.projection.refresh(); assert.equal(f.projection.subject, undefined);
});

test('context disposal retires Details once even without a newer admitted source revision', t => {
	const f = fixture(t), scene = f.document.scenes[0];
	f.authoring.select(f.document, f.model.version, { kind: 'scene', scene }); f.projection.refresh();
	const sourceRevision = f.authoring.revision, revision = f.projection.revision;
	f.authoring.dispose();
	assert.equal(f.authoring.revision, sourceRevision); assert.equal(f.projection.refresh(), true);
	assert.equal(f.projection.subject, undefined); assert.equal(f.projection.revision, revision + 1);
	assert.equal(f.projection.refresh(), false); assert.equal(f.projection.revision, revision + 1);
});
