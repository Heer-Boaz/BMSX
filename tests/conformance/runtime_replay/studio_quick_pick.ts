import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';

import { editorViewState } from '../../../ide/editor/ui/view/state';

import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import type { ResourceQuickPickItem } from '../../../ide/workbench/contrib/resources/quick_access';
import { sourcePane, check, type StudioFixture } from './studio_fixture';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { testStudioQuickInputInteraction } from './studio_quick_input_interaction';

/** No direct picker calls: physical workbench shortcut, pointer, clipboard and navigation. */
export async function testStudioQuickPick(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, until, clipboard, cycles, setPointerButton } = test;
	console.info('STUDIO: workbench-owned quick input from real non-code panes');
	// The title selector has an authored position; the root composition does not.
	harness.openLuaSource('scenes/title.lua');
	const parts = ide.editor.editorParts;
	const existingTabs = new Set(parts.groups.flatMap(group => group.model.tabs));
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const position = cycles();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 1);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('quick pick: actual Scene Editor required');
	const primary = ide.editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('Scene document must admit its actual companion controls');
	const x = primary.details.control.controls[0];
	const picker = ide.editor.quickInput;
	const searchSceneFile = async () => {
		await press('ControlLeft', 'KeyP');
		await clipboard.writeText(model.resource.path);
		await press('ControlLeft', 'KeyV');
		check((picker.model.list.rows[0]?.item as ResourceQuickPickItem | undefined)?.resource === model.resource,
			'quick pick: exact path selects the invoking Scene working copy');
	};
	await click(scene.view.details.properties[0].bounds);
	const codeTop = editorViewState.editorAreaTop;
	await press('ControlLeft', 'KeyP');
	check(picker.visible && picker.field.focusTarget.hasFocus && ide.editor.editorParts.activeGroup.model.activeTab === scene,
		'quick pick: workbench search does not activate a hidden code editor');
	check(editorViewState.editorAreaTop === codeTop && picker.layout.bounds.right === editorViewState.viewportWidth - 8,
		'quick pick: overlay has its own viewport, not a code inline bar');
	await testStudioQuickInputInteraction(test);
	for (const code of ['KeyT', 'KeyI', 'KeyT', 'KeyL', 'KeyE']) await press(code);
	await press('ControlLeft', 'KeyZ');
	check(picker.field.text === 'titl' && model.buffer.getText() === original, 'quick pick: query Undo does not reach scene history');
	await press('ControlLeft', 'KeyY');
	check(picker.field.text === 'title' && picker.model.list.rows.some(row => (row.item as ResourceQuickPickItem).resource === model.resource),
		'quick pick: retained matches follow field Redo');
	await press('Escape');
	check(!picker.visible && inputFocus.target === x.field.focusTarget, 'quick pick: Escape restores the exact invoking property');

	await press('ControlLeft', 'KeyA'); await press('Digit7');
	check(x.pending, 'quick pick: real property draft exists before navigation');
	await press('ControlLeft', 'KeyP');
	check(!x.pending && scene.view.details.properties[0].descriptor.value === 7, 'quick pick: the property owner commits valid blur, not the picker');
	await press('Escape');
	await press('Enter');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'quick pick: committed property remains one ordinary document Undo');
	await click(scene.view.details.properties[0].bounds);
	await press('ControlLeft', 'KeyA'); await press('Minus');
	await press('ControlLeft', 'KeyP');
	check(!x.pending && model.buffer.getText() === original, 'quick pick: invalid property blur follows its existing cancel policy');
	await press('Escape');
	check(inputFocus.target === x.field.focusTarget, 'quick pick: cancelled draft still has a concrete return control');

	await press('ControlLeft', 'KeyP');
	await clipboard.writeText('long_query_'.repeat(100) + '\r\n\tend');
	await press('ControlLeft', 'KeyV');
	check(picker.field.text === 'long_query_'.repeat(100) + 'end' && picker.field.lines.length === 1,
		'quick pick: long external paste is not length-capped and remains a single-line query');
	check(picker.textViewport.start > 0 && picker.textViewport.end === picker.field.text.length,
		'quick pick: caret reveals the end of the full query');
	await press('Home');
	check(picker.textViewport.start === 0 && picker.field.cursorColumn === 0, 'quick pick: Home moves the text caret, not the item selection');
	await press('End');
	await press('Enter');
	check(picker.visible && picker.model.list.selectionIndex === -1 && ide.editor.editorParts.activeGroup.model.activeTab === scene,
		'quick pick: Enter with no matches neither closes nor navigates to invented source');
	await press('ControlLeft', 'KeyA');
	await press('Backspace');
	const outlineScroll = scene.view.hierarchy.outline.scroll;
	test.remote.apply([{ type: 'wheel', deltaY: 3 }]);
	await frame();
	await frame();
	check(picker.model.viewport.scrollTop > 0 && scene.view.hierarchy.outline.scroll === outlineScroll, 'quick pick: wheel scrolls only the popup list');
	await press('PageDown');
	check(picker.model.list.selectionIndex >= picker.model.firstVisibleIndex, 'quick pick: keyboard selection is revealed after wheel scrolling');
	await click(editorChromeState.menuButtonBounds, 8);
	check(!picker.visible && test.ide.editor.menubar.activeMenu === undefined && inputFocus.target === x.field.focusTarget,
		'quick pick: one outside held click cancels without clicking through into the View menu');

	await test.openMenu('tools');
	await test.clickContextCommand('scenarioLab');
	const scenario = ide.editor.editorParts.activeGroup.model.activeTab;
	check(scenario.kind === 'scenario_lab', 'quick pick: actual Scenario Lab is active');
	const scenarioFocus = inputFocus.target;
	await press('ControlLeft', 'KeyP');
	check(picker.visible && ide.editor.editorParts.activeGroup.model.activeTab === scenario, 'quick pick: file search is visible without leaving Scenario Lab');
	await press('Escape');
	check(inputFocus.target === scenarioFocus, 'quick pick: Scenario Lab regains its own focus');
	await searchSceneFile();
	await press('Enter');
	await until(() => ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && sourcePane(test).code.model === model,
		'quick pick: Scenario Lab selection opens the exact retained Scene source through normal navigation');

	// A lower code widget must not consume the popup's Escape.
	await press('ControlLeft', 'KeyF');
	const findTarget = inputFocus.target;
	await press('ControlLeft', 'KeyP');
	await press('Escape');
	check(sourcePane(test).find.state.visible && inputFocus.target === findTarget, 'quick pick: Escape dismisses the topmost input, not Find behind it');
	await press('Escape');
	await openSceneEditor(test);
	await press('ControlLeft', 'KeyP');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive && !picker.visible, 'quick pick: IDE deactivation closes the transient input through blur');
	await press('ControlRight', 'ShiftRight');
	check(ide.editor.isActive && ide.editor.editorParts.activeGroup.model.activeTab === scene && !picker.visible, 'quick pick: IDE reopen restores the scene, not an orphaned popup');
	await searchSceneFile();
	const bounds = picker.model.viewport.bounds;
	await click({ left: bounds.left, right: bounds.right,
		top: bounds.top, bottom: bounds.top + picker.model.rowHeight }, 8);
	await until(() => ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && sourcePane(test).code.model === model,
		'quick pick: held pointer acceptance opens once through the resource owner');
	check(!picker.visible && model.buffer.getText() === original && cycles() === position,
		'quick pick: the complete input loop preserves source and paused execution');

	// Open the popup while a real lower scrollbar still captures a held mouse press.
	const thumb = sourcePane(test).code.scrollbars.codeVertical.getThumb();
	check(thumb !== null, 'quick pick: the real root source exposes a vertical scrollbar');
	await click(thumb);
	setPointerButton('pointer_primary', true);
	await frame();
	check(pointerCapture.active, 'quick pick: real scrollbar drag is active before opening');
	await press('ControlLeft', 'KeyP');
	check(picker.visible && !pointerCapture.active, 'quick pick: exclusive input ends the lower pointer capture');
	const scroll = sourcePane(test).code.view.scrollRow;
	setPointerButton('pointer_primary', false);
	await frame();
	await press('Escape');
	check(!pointerCapture.active && sourcePane(test).code.view.scrollRow === scroll,
		'quick pick: release and dismissal do not revive a stale drag');
	if (!existingTabs.has(scene))
		check(await parts.findGroup(scene)!.close(scene.id), 'quick pick: the fixture-owned Scene releases its editor allocation');
}

/** Final backend screenshot: actual workbench picker above the already-proven scene view. */
export async function presentWorkbenchQuickPick(test: StudioFixture): Promise<void> {
	await test.press('ControlLeft', 'KeyP');
	for (const code of ['KeyS', 'KeyC', 'KeyE', 'KeyN', 'KeyE']) await test.press(code);
	check(test.ide.editor.quickInput.visible && test.ide.editor.editorParts.activeGroup.model.activeTab.kind === 'scene_editor', 'quick pick: final overlay remains independent of the visual pane');
	await test.frame();
}
