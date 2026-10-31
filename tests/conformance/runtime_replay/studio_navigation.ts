
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { getCodeAreaBounds } from '../../../ide/editor/ui/view/view';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import type { EditorCommandId } from '../../../ide/common/commands';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { ProjectContentEntry } from '../../../ide/workbench/contrib/resources/content_index';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { sourcePane, check, type StudioFixture } from './studio_fixture';
import { chooseBehavior } from './studio_behavior_picker';

async function openView(test: StudioFixture, command: EditorCommandId): Promise<void> {
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = test.ide.editor.contextMenu.model.rows.find(row => row.command === command)!;
	check(item.enabled, `navigation: ${command} is enabled from ${test.ide.editor.editorParts.activeGroup.model.activeTab.kind}`);
	await test.clickContextCommand(item.command!);
}

async function chooseSource(test: StudioFixture, path: string): Promise<void> {
	const picker = test.ide.editor.quickInput;
	check(picker.visible, 'navigation: source choice uses the workbench picker');
	await test.clipboard.writeText(path);
	await test.press('ControlLeft', 'KeyV');
	const rows = picker.model.list.rows;
	const selected = rows.findIndex(row => (row.item as QuickPickItem & { entry: Extract<ProjectContentEntry, { kind: 'scene' }> }).entry.ownerResource.path === path);
	check(selected >= 0, 'navigation: the actual Scene occurrence is discoverable without an open code pane');
	await test.press('ControlLeft', 'Home'); for (let row = 0; row < selected; row++) await test.press('ArrowDown');
	await test.press('Enter');
	await test.until(() => test.ide.editor.mainWorkspace.primary instanceof ScenePrimaryClient,
		'navigation: the accepted Scene is presented in visual Main');
}

export async function testStudioNavigation(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, cycles } = test;
	const position = cycles();
	console.info('STUDIO: globals and source-backed views through actual workbench input');
	const bios = ide.sources.catalog.luaResources.find(resource => resource.contextId === test.ide.sources.currentBlua32Media.system!.sourceContextId && resource.path === 'main.lua')!;
	await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), bios);
	await press('ControlLeft', 'Home');
	const lines = sourcePane(test).code.model.buffer.getText().split('\n');
	const row = lines.findIndex(line => line.startsWith("os = require('os')"));
	check(row >= 0, 'navigation: actual BIOS global assignment is present');
	const bounds = getCodeAreaBounds(sourcePane(test).code);
	const x = bounds.textLeft + editorViewState.font.advance('o') / 2;
	const y = bounds.codeTop + (row + 0.5) * editorViewState.lineHeight;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 }, 1, 'pointer_secondary');
	check(ide.editor.contextMenu.visible,
		'navigation: actual secondary click on global os opens the source menu');
	check(ide.editor.contextMenu.model.rows.some(entry => entry.command === 'goToDefinition'),
		'navigation: builtin spelling does not hide source navigation');
	check(ide.editor.contextMenu.model.rows.find(entry => entry.command === 'rename')!.enabled === !sourcePane(test).code.model.readOnly,
		'navigation: Rename follows the actual source model admission, not BIOS/cart classification');
	await press('Escape');

	harness.openLuaSource('cart.lua');
	await frame();
	const entryInput = ide.editor.editorParts.activeGroup.model.activeTab;
	await openView(test, 'sceneEditor');
	check(entryInput.kind === 'code_editor' && ide.editor.editorParts.groups.some(group => group.model.activeTab === entryInput), 'navigation: entry file is retained and not silently installed as an empty scene');
	check(!ide.editor.editorParts.main.quickInput.model.items.some(row => row.label === 'cart.lua'),
		'navigation: the catalog contains scene registrations, not every Lua file');
	await chooseSource(test, 'scenes/root.lua');
	const scene = ide.editor.mainWorkspace.primary;
	if (!(scene instanceof ScenePrimaryClient)) throw new Error('navigation: selected visual Scene missing');
	check(scene.consumer.workingCopy.resource.path === 'scenes/root.lua' && scene.viewport.attached,
		'navigation: tool title and exact source identity are separate');
	const selected = scene.view.hierarchy.outline.rows[scene.view.hierarchy.outline.selectionIndex].element.source;
	await test.runPaletteCommand('Editor: Open Source');
	check(ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && sourcePane(test).code.model === scene.consumer.workingCopy
		&& sourcePane(test).code.view.cursorRow === selected.start.line - 1,
		'navigation: Source reveals the selected scene syntax in root.lua, not cart.lua');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	const lens = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens') throw new Error('navigation: selected lens input missing');
	check(lens.view.document.definitions.length > 0,
		'navigation: the actual title FSM is visible under its definition title');
	const sourceRange = selectedBehaviorLensSourceRange(lens.view)!;
	await click(lens.view.presentation.actionBar.items[0].bounds);
	const code = ide.editor.editorParts.activeGroup.model.activeTab;
	check(code.kind === 'code_editor' && sourcePane(test).code.model === lens.workingCopy
		&& sourcePane(test).code.view.cursorRow === sourceRange.start.line - 1,
		'navigation: visible Lens Source action reveals the selected FSM source range');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	ide.editor.editorParts.activeGroup.close(code.id);
	await frame();
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens, 'navigation: lens remains attached when its code tab closes');
	await openView(test, 'scenarioLab');
	await openView(test, 'sceneEditor');
	await chooseSource(test, 'scenes/root.lua');
	const reopened = ide.editor.mainWorkspace.primary;
	check(reopened instanceof ScenePrimaryClient && reopened.consumer.workingCopy === scene.consumer.workingCopy
		&& reopened.consumer.subject === reopened.consumer.document!.scenes[0], 'navigation: Scene authoring reuses canonical source outside document groups');
	await openView(test, 'scenarioLab');
	await openView(test, 'behaviorLens');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens, 'navigation: Scenario Lab opens the retained lens without a code-tab requirement');
	check(cycles() === position, 'navigation: choosing sources does not mutate or run the paused machine');
	harness.openLuaSource('scenes/root.lua');
}
