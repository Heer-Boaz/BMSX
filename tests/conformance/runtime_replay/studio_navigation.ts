
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import type { EditorCommandId } from '../../../ide/common/commands';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { ProjectContentEntry } from '../../../ide/workbench/contrib/resources/content_index';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { codePositionBounds, sourcePane, check, type StudioFixture } from './studio_fixture';
import { chooseBehavior } from './studio_behavior_picker';

async function openTool(test: StudioFixture, command: EditorCommandId): Promise<void> {
	await test.openMenu('tools');
	await test.clickContextCommand(command);
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
	const destination = ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup);
	await ide.editor.navigation.openResource(destination, bios);
	const model = sourcePane(test).code.model;
	let row = 0;
	while (row < model.buffer.getLineCount() && !model.buffer.getLineContent(row).startsWith("os = require('os')")) row++;
	check(row < model.buffer.getLineCount(), 'navigation: actual BIOS global assignment is present');
	await ide.editor.navigation.openResource(destination, bios, { selection: { row, startColumn: 1, endColumn: 1 } });
	await frame();
	await click(() => codePositionBounds(test, row, 1), 1, 'pointer_secondary');
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
	await openTool(test, 'sceneEditor');
	check(entryInput.kind === 'code_editor' && ide.editor.editorParts.groups.some(group => group.model.activeTab === entryInput), 'navigation: entry file is retained and not silently installed as an empty scene');
	check(!ide.editor.quickInput.model.items.some(item =>
		(item as QuickPickItem & { entry: Extract<ProjectContentEntry, { kind: 'scene' }> }).entry.ownerResource === entryInput.resource),
		'navigation: the catalog contains scene registrations, not every Lua file');
	await chooseSource(test, 'scenes/root.lua');
	const scene = ide.editor.mainWorkspace.primary;
	if (!(scene instanceof ScenePrimaryClient)) throw new Error('navigation: selected visual Scene missing');
	check(scene.authoring.workingCopy.resource.path === 'scenes/root.lua' && scene.input === ide.editor.editorParts.activeGroup.model.activeTab,
		'navigation: tool title and exact source identity are separate');
	const selected = scene.view.hierarchy.outline.rows[scene.view.hierarchy.outline.selectionIndex].element.source;
	await test.runPaletteCommand('editor.source');
	check(ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && sourcePane(test).code.model === scene.authoring.workingCopy
		&& sourcePane(test).code.view.cursorRow === selected.start.line - 1,
		'navigation: Source reveals the selected scene syntax in root.lua, not cart.lua');
	await openTool(test, 'behaviorLens.stateMachines');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	const lens = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens') throw new Error('navigation: selected lens input missing');
	check(lens.view.document.definitions.length > 0,
		'navigation: the actual title FSM is visible under its definition title');
	const sourceRange = selectedBehaviorLensSourceRange(lens.view)!;
	await test.runPaletteCommand('editor.source');
	const code = ide.editor.editorParts.activeGroup.model.activeTab;
	check(code.kind === 'code_editor' && sourcePane(test).code.model === lens.workingCopy
		&& sourcePane(test).code.view.cursorRow === sourceRange.start.line - 1,
		'navigation: Open Source on the Lens reveals the selected FSM source range');
	await openTool(test, 'behaviorLens.stateMachines');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	ide.editor.editorParts.activeGroup.close(code.id);
	await frame();
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens, 'navigation: lens remains attached when its code tab closes');
	await openTool(test, 'scenarioLab');
	await openTool(test, 'sceneEditor');
	await chooseSource(test, 'scenes/root.lua');
	const reopened = ide.editor.mainWorkspace.primary;
	check(reopened instanceof ScenePrimaryClient && reopened.authoring.workingCopy === scene.authoring.workingCopy
		&& reopened.authoring.subject === reopened.authoring.document!.scenes[0], 'navigation: Scene authoring reuses canonical source outside document groups');
	await openTool(test, 'scenarioLab');
	await openTool(test, 'behaviorLens.stateMachines');
	await chooseBehavior(test, 'FSM nemesis_s.title_screen.fsm');
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens, 'navigation: Scenario Lab opens the retained lens without a code-tab requirement');
	check(cycles() === position, 'navigation: choosing sources does not mutate or run the paused machine');
	harness.openLuaSource('scenes/root.lua');
}
