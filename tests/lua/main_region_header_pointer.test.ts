import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ide/workbench/ui/action_bar';
import { SCENE_AUTHORING_SOURCE } from '../fixtures/studio/scene_authoring';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const font of ['tiny', 'msx'] as const) for (const region of ['hierarchy', 'details'] as const)
	test(`Main ${font} ${region} header Secondary opens only its panel context over More`, async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_AUTHORING_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(font); f.first.focus();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	f.update();
	f.editor.mainWorkspace.focusPrimary(region);
	const panel = primary[region];
	assert.equal(panel.actionBar.focusTarget.focus(), true); f.update();
	const action = panel.actionBar.tooltipItem;
	assert.ok(action?.command === WORKBENCH_ACTION_BAR_OVERFLOW);
	const source = model.buffer.getText();
	// Geometry drives the real hit target. The assertions concern native routing and ownership.
	const x = (action.bounds.left + action.bounds.right) / 2, y = (action.bounds.top + action.bounds.bottom) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y) === f.editor.surfaces.findByScope(panel.scope.surfaceScope));
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
		pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === `workspace.${region}.toggle` && row.enabled));
	assert.ok(!f.editor.contextMenu.model.rows.some(row => row.command === 'editor.source'), 'header chrome does not borrow a Scene member action');
	assert.ok(f.editor.mainWorkspace.primary === primary && primary.hierarchy.attached && primary.details.attached);
	assert.equal(model.buffer.getText(), source);
	f.editor.contextMenu.hide();
	f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(model)); f.update();
	assert.equal(panel.actionBar.focusTarget.focus(), false, 'a detached Scene header cannot receive input behind Source');
});
