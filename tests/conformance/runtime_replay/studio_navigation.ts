import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { getCodeAreaBounds } from '../../../ide/editor/ui/view/view';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab, closeTab } from '../../../ide/workbench/ui/tabs';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import type { EditorViewCommandId } from '../../../ide/common/commands';
import { check, type StudioFixture } from './studio_fixture';
import { chooseBehavior } from './studio_behavior_picker';

async function openView(test: StudioFixture, command: EditorViewCommandId): Promise<void> {
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = TOP_BAR_MENUS.view.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === command)!;
	check(!item.disabled, `navigation: ${command} is enabled from ${getActiveTab().kind}`);
	await test.click(item.bounds);
}

async function chooseSource(test: StudioFixture, path: string): Promise<void> {
	const picker = test.ide.editor.quickInput;
	check(picker.visible, 'navigation: source choice uses the workbench picker');
	test.clipboard.text = path;
	await test.press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.label === path,
		'navigation: the actual source declaration is discoverable without an open code pane');
	await test.press('Enter');
}

export async function testStudioNavigation(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, cycles } = test;
	const position = cycles();
	console.info('STUDIO: globals and source-backed views through actual workbench input');
	const bios = ide.sources.luaResources.find(resource => resource.domain === -1 && resource.path === 'main.lua')!;
	await ide.editor.navigation.openResource(bios);
	await press('ControlLeft', 'Home');
	const lines = activeCodeEditor.model.buffer.getText().split('\n');
	const row = lines.findIndex(line => line.startsWith("os = require('os')"));
	check(row >= 0, 'navigation: actual BIOS global assignment is present');
	const bounds = getCodeAreaBounds();
	const x = bounds.textLeft + editorViewState.font.advance('o') / 2;
	const y = bounds.codeTop + (row + 0.5) * editorViewState.lineHeight;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 }, 1, 'pointer_secondary');
	check(ide.editor.contextMenu.visible,
		'navigation: actual secondary click on global os opens the source menu');
	check(ide.editor.contextMenu.model.rows.some(entry => entry.command === 'goToDefinition'),
		'navigation: builtin spelling does not hide source navigation');
	check(ide.editor.contextMenu.model.rows.find(entry => entry.command === 'rename')!.enabled === !activeCodeEditor.model.readOnly,
		'navigation: Rename follows the actual source model admission, not BIOS/cart classification');
	await press('Escape');

	harness.openLuaSource('cart.lua');
	await frame();
	await openView(test, 'sceneEditor');
	check(getActiveTab().kind === 'code_editor', 'navigation: entry file is not silently installed as an empty scene');
	check(!ide.editor.quickInput.model.entries.some(row => row.item.label === 'cart.lua'),
		'navigation: the catalog contains scene registrations, not every Lua file');
	await chooseSource(test, 'scenes/root.lua');
	const scene = getActiveTab();
	if (scene.kind !== 'scene_editor') throw new Error('navigation: selected scene input missing');
	check(scene.title === 'SCENE EDITOR' && scene.workingCopy.resource.path === 'scenes/root.lua',
		'navigation: tool title and exact source identity are separate');
	const selected = scene.outline.rows[scene.outline.selectionIndex].element.source;
	await click(scene.actionBar.items[0].bounds);
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === scene.workingCopy
		&& activeCodeEditor.view.cursorRow === selected.start.line - 1,
		'navigation: Source reveals the selected scene syntax in root.lua, not cart.lua');
	await openView(test, 'sceneEditor');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('navigation: selected lens input missing');
	check(lens.title === 'FSM nemesis_s.title_screen.fsm' && lens.view.document.definitions.length > 0,
		'navigation: the actual title FSM is visible under its definition title');
	const sourceRange = selectedBehaviorLensSourceRange(lens.view)!;
	await click(lens.view.presentation.actionBar.items[0].bounds);
	const code = getActiveTab();
	check(code.kind === 'code_editor' && activeCodeEditor.model === lens.workingCopy
		&& activeCodeEditor.view.cursorRow === sourceRange.start.line - 1,
		'navigation: visible Lens Source action reveals the selected FSM source range');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	closeTab(ide.editor.editorPanes, ide.sources, code.id);
	await frame();
	check(getActiveTab() === lens, 'navigation: lens remains attached when its code tab closes');
	await openView(test, 'scenarioLab');
	await openView(test, 'sceneEditor');
	await chooseSource(test, 'scenes/root.lua');
	check(getActiveTab() === scene, 'navigation: Scenario Lab opens the same retained scene model');
	await openView(test, 'scenarioLab');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	check(getActiveTab() === lens, 'navigation: Scenario Lab opens the retained lens without a code-tab requirement');
	check(cycles() === position, 'navigation: choosing sources does not mutate or run the paused machine');
	harness.openLuaSource('scenes/root.lua');
}
