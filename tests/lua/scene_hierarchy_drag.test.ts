import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import type { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import type { SceneHierarchyControl } from '../../ide/workbench/contrib/scene_editor/hierarchy_control';
import type { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='actor3',class=require('cartlib/world/object_3d')})
scenes.register('room',{objects={
 -- parent and child are deliberately independent source fields.
 {member_id='a',definition_id='actor2',position={x=10,y=20}},
 {member_id='child',definition_id='actor2',parent='a',position={x=2,y=3}},
 {member_id='b',definition_id='actor2',position={x=50,y=60}},
 {member_id='c',definition_id='actor2',position={x=70,y=80}},
 {member_id='three',definition_id='actor3',position={x=7,y=8,z=9}},
}})
scenes.register('other',{objects={{member_id='other',definition_id='actor2'}}})`;

async function fixture(t: TestContext, main = true, font: 'tiny' | 'msx' = 'tiny', source = SOURCE) {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', source], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(font); f.firstBounds.right = 700;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.editor.editorParts.minimize(f.secondPart);
	let hierarchy: SceneHierarchyControl, details: SceneDetailsControl, context: SceneAuthoringContext;
	if (main) {
		f.editor.editorParts.minimize(f.firstPart);
		const document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
		const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
		hierarchy = primary.hierarchy.control; details = primary.details.control; context = primary.authoring;
	} else {
		f.editor.sceneEditor.openResource(f.firstGroup, resource); f.update();
		const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
		const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
		hierarchy = primary.hierarchy.control; details = primary.details.control; context = primary.authoring;
	}
	f.update(); hierarchy.focus(); f.update();
	const point = (id: string, placement: 'before' | 'inside' | 'after' = 'inside') => {
		const tree = hierarchy.view.outline, index = tree.rows.findIndex(row => row.element.kind === 'member'
			&& row.element.entry.kind === 'object' && stringLiteralValue(row.element.entry.memberId) === id);
		assert.ok(index >= 0);
		const row = tree.rows[index], layout = tree.layout;
		return { x: layout.contentLeft + (row.depth + 1) * layout.indentWidth + 3,
			y: layout.contentTop + (index - (tree.scroll | 0)) * layout.rowHeight
				+ (placement === 'before' ? 1 : placement === 'after' ? layout.rowHeight - 1 : layout.rowHeight / 2) };
	};
	const send = (point: { x: number; y: number }, down: boolean, pressed = false, modifiers = KeyModifier.none) => {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', ...point, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: pressed ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers, spaceDown: false, timestamp: f.host.clock.now() });
		f.update();
	};
	const drag = (source: string, target: string, placement: 'before' | 'inside' | 'after') => {
		const start = point(source), end = point(target, placement);
		send(start, true, true); send(end, true); send(end, false);
	};
	return { ...f, model, context, hierarchy, details, point, send, drag };
}

function worlds(context: SceneAuthoringContext) {
	context.refresh(); const spatial = context.spatialScene!;
	// Origin and unit-axis endpoints are the world-pose contract. A zero's sign
	// in an intermediate affine coefficient is not a different geometric pose.
	return new Map(spatial.entries.map(entry => {
		const pose = spatial.worlds.get(entry)!;
		return [stringLiteralValue(entry.memberId), pose.family === '2d'
			? [pose.ox, pose.oy, pose.ox + pose.xx, pose.oy + pose.xy, pose.ox + pose.yx, pose.oy + pose.yy]
			: [pose.ox, pose.oy, pose.oz, pose.ox + pose.xx, pose.oy + pose.xy, pose.oz + pose.xz,
				pose.ox + pose.yx, pose.oy + pose.yy, pose.oz + pose.yz, pose.ox + pose.zx, pose.oy + pose.zy, pose.oz + pose.zz]];
	}));
}

for (const main of [true, false]) for (const font of ['tiny', 'msx'] as const)
	test(`${font} ${main ? 'Main' : 'document'} hierarchy reorders a whole visible branch with one canonical Undo`, async t => {
		const f = await fixture(t, main, font), version = f.model.version;
		const before = main ? worlds(f.context) : undefined;
		f.drag('a', 'c', 'after');
		assert.equal(f.model.version, version + 1); assert.equal(pointerCapture.active, false);
		const selected = f.context.selection; assert.ok(selected?.kind === 'member' && selected.entry.kind === 'object');
		assert.equal(stringLiteralValue(selected.entry.memberId), 'a');
		const roots = f.hierarchy.view.outline.roots[0].children;
		assert.deepEqual(roots.map(node => {
			const element = node.element; assert.ok(element.kind === 'member' && element.entry.kind === 'object');
			return stringLiteralValue(element.entry.memberId);
		}), ['b', 'c', 'a', 'three']);
		const child = roots[2].children[0].element; assert.ok(child.kind === 'member' && child.entry.kind === 'object');
		assert.equal(stringLiteralValue(child.entry.memberId), 'child');
		if (main) assert.deepEqual(worlds(f.context), before);
		const changed = f.model.buffer.getText();
		assert.ok(changed !== SOURCE); const dirty = editorTextModelService.dirtyWorkingCopies;
		assert.equal(dirty.length, 1); assert.ok(dirty[0] === f.model);
		f.model.undo(); f.update(); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
		f.model.redo(); f.update(); assert.equal(f.model.buffer.getText(), changed);
	});

for (const operation of ['inside', 'before'] as const) test(`Main hierarchy ${operation} drop reparents and orders without moving the visible world pose`, async t => {
	const f = await fixture(t), before = worlds(f.context), version = f.model.version;
	f.drag(operation === 'inside' ? 'a' : 'child', operation === 'inside' ? 'b' : 'c', operation);
	assert.equal(f.model.version, version + 1); assert.deepEqual(worlds(f.context), before);
	const selected = f.context.selection; assert.ok(selected?.kind === 'member' && selected.entry.kind === 'object');
	const parents = f.context.getSpatialParents(selected.scene), parent = parents.get(selected.entry);
	assert.equal(parent === undefined ? undefined : stringLiteralValue(parent.memberId), operation === 'inside' ? 'b' : undefined);
	assert.ok(f.hierarchy.view.outline.selectionIndex >= 0, 'the moved selection remains revealed under its actual new parent');
	f.model.undo(); f.update(); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const target of ['child', 'three'] as const) test(`a rejected ${target === 'child' ? 'descendant' : 'cross-family'} parent drop never produces history`, async t => {
	const f = await fixture(t), version = f.model.version;
	f.drag('a', target, 'inside');
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	assert.equal(pointerCapture.active, false);
});

for (const retirement of ['Escape', 'source', 'font', 'hide', 'readOnly'] as const)
	test(`${retirement} retires the actual Main hierarchy hold instead of moving another row on release`, async t => {
		const f = await fixture(t), start = f.point('a'), end = f.point('c', 'after');
		f.send(start, true, true); f.send(end, true); assert.equal(pointerCapture.active, true);
		switch (retirement) {
			case 'Escape': f.key('Escape'); break;
			case 'source': f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external\n' }]); break;
			case 'font': f.editor.setFontVariant('msx'); break;
			case 'hide': f.editor.mainWorkspace.setRegionVisible('hierarchy', false); break;
			case 'readOnly': f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } }); break;
		}
		f.update(); const source = f.model.buffer.getText(), version = f.model.version;
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
		f.send(end, false); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
		assert.equal(pointerCapture.draining, false);
	});

test('a departing Details draft can publish newer selection without arming the obsolete pressed row', async t => {
	const f = await fixture(t); f.editor.mainWorkspace.focusPrimary('hierarchy'); f.key('Home'); f.key('ArrowDown');
	const field = f.details.controls[0], version = f.model.version;
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '42', true);
	const release = f.model.onDidChangeContent(() => {
		release(); f.context.refresh(); const scene = f.context.subject!;
		f.context.select(f.context.document!, f.model.version, { kind: 'scene', scene });
	}); t.after(release);
	f.drag('b', 'c', 'after');
	assert.equal(f.model.version, version + 1); assert.equal(f.context.selection?.kind, 'scene');
	assert.equal(f.model.buffer.getText(), SOURCE.replace('x=10', 'x=42'));
	assert.equal(pointerCapture.active, false);
});

test('a pending press cannot adopt a later selection even when it returns to the same occurrence', async t => {
	const f = await fixture(t), end = f.point('c', 'after');
	f.send(f.point('a'), true, true);
	const original = f.context.selection!;
	assert.equal(f.context.select(f.context.document!, f.model.version, { kind: 'scene', scene: original.scene }), true);
	assert.equal(f.context.select(f.context.document!, f.model.version, original), true);
	f.send(end, true); f.send(end, false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	assert.equal(pointerCapture.active, false);
});

for (const retirement of ['source', 'provider', 'readOnly', 'context'] as const)
	test(`${retirement} also retires a pending hierarchy press before the drag threshold`, async t => {
		const f = await fixture(t), end = f.point('c', 'after');
		f.send(f.point('a'), true, true);
		switch (retirement) {
			case 'source': f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external\n' }]); break;
			case 'provider': {
				const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'cartlib/world/object_2d.lua' })!;
				resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource)
					.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider\n' }]);
				break;
			}
			case 'readOnly': {
				const resource = f.model.resource;
				f.model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
				f.model.refreshResource(resource); break;
			}
			case 'context': f.hierarchy.inputScope.retireContext(); break;
		}
		f.update(); const source = f.model.buffer.getText(), version = f.model.version;
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
		f.send(end, true); f.send(end, false);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
		assert.equal(pointerCapture.draining, false);
	});


for (const main of [true, false]) test(`${main ? 'Main' : 'document'} hierarchy uses the release modifier for a local-only parent`, async t => {
	const source = SOURCE.replace("position={x=50,y=60}", "position={x=50,y=60},scale={x=0,y=0}");
	const f = await fixture(t, main, 'tiny', source), version = f.model.version;
	const start = f.point('child'), target = f.point('b');
	f.send(start, true, true); f.send(target, true); f.send(target, false);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), source);
	f.send(start, true, true); f.send(target, true); f.send(target, false, false, KeyModifier.alt);
	assert.equal(f.model.version, version + 1);
	assert.ok(f.model.buffer.getText().includes('position={x=2,y=3}'));
	const selected = f.context.selection; assert.ok(selected?.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(stringLiteralValue(f.context.getSpatialParents(selected.scene).get(selected.entry)!.memberId), 'b');
	f.model.undo(); f.update(); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});
