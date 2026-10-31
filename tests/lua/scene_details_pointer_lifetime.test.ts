import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { measureSceneEditorMinimumWidth } from '../../ide/workbench/contrib/scene_editor/layout';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

for (const font of ['tiny', 'msx'] as const) test(`${font} hidden Details cannot handle pointer input through a retired field binding`, t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(font);
	f.firstBounds.right = measureSceneEditorMinimumWidth() + 40;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	pane.control.hierarchy.focus(); f.key('Home'); f.key('ArrowDown');
	const view = pane.control.view, details = pane.control.details;
	assert.ok(view.authoring.selection?.kind === 'member');
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget); f.update();
	assert.equal(view.layout.mode, 'details');
	assert.ok(details.options.controls.length > 0, 'the selected authored member admits real expression editors');
	f.editor.commands.execute('sceneEditor.outline', pane.commandTarget); f.update(); f.key('Home');
	assert.equal(view.layout.mode, 'outline'); assert.equal(view.authoring.selection?.kind, 'scene');
	assert.equal(view.details.optionProperties.length, 0);
	const before = view.authoring.workingCopy.buffer.getText();
	const tree = view.hierarchy.outline, root = tree.rows[0], layout = tree.layout;
	// Production layout only locates the real row; assertions concern routing, selection and source lifetime.
	const x = layout.contentLeft + (root.depth + 1.5) * layout.indentWidth;
	const y = layout.contentTop + (0.5 - tree.scroll) * layout.rowHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
	assert.equal(view.authoring.selection?.kind, 'scene');
	assert.equal(view.authoring.workingCopy.buffer.getText(), before); assert.equal(view.authoring.workingCopy.dirty, false);
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget); f.update();
	assert.equal(view.layout.mode, 'details'); assert.equal(details.options.controls.length, 0);
	f.editor.commands.execute('sceneEditor.outline', pane.commandTarget); f.update(); f.key('ArrowDown');
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget); f.update();
	assert.ok(view.authoring.selection?.kind === 'member');
	assert.equal(details.options.controls.length, view.details.optionProperties.length);
});
