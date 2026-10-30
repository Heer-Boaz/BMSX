import { inputFocus } from '../../../ide/input/focus';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { RomInspectorSnapshot } from '../../../ide/workbench/contrib/rom_inspector/model';
import type { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import type { WorkbenchFloatingWindow } from '../../../ide/workbench/ui/window/control';
import { check, type StudioFixture } from './studio_fixture';

type WindowChoice = QuickPickItem & { readonly window: WorkbenchFloatingWindow | undefined };

/** Actual layout commands retain every document and authored subject while resetting their own presentation intent. */
export async function testStudioLayoutReset(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const { ide, press, frame } = test, editor = ide.editor, main = editor.mainWorkspace, parts = editor.editorParts;
	const sourceGroup = parts.findGroup(source)!, model = source.workingCopy;
	const text = model.buffer.getText(), version = model.version, dirty = model.dirty, undo = model.canUndo, redo = model.canRedo;
	const selected = { ...client.consumer.selectionRange }, before = test.cycles(), media = ide.sources.currentBlua32Media;
	const activityVisible = main.regionLayout.activityVisible;
	console.info(`STUDIO: Reset Layout ${editor.fontVariant} theme ${theme}`);
	await test.runPaletteCommand('Workspace: Hide Details');
	await test.runPaletteCommand('Workspace: Focus Hierarchy');
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	await test.runPaletteCommand('Workspace: Move Hierarchy to New Window');
	await test.runPaletteCommand('Workspace: Focus Details');
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	await test.runPaletteCommand('Workspace: Move Details to New Window');
	await test.runPaletteCommand('View: Problems Panel');
	const activity = main.activity;
	await test.runPaletteCommand('Workspace: Move Activity Area to New Window');
	await test.runPaletteCommand('Window: Minimize Window');
	await test.runPaletteCommand('Workspace: Focus Hierarchy');
	await press('ContextMenu'); await test.clickContextCommand('editor.sourceToSide');
	await test.until(() => {
		const input = parts.activeGroup.model.activeTab;
		return input.kind === 'code_editor' && input !== source && input.workingCopy === model;
	}, 'Reset Layout: explicit Source to Side admits an independent view over the existing canonical model');
	const comparison = parts.activeGroup.model.activeTab;
	if (comparison.kind !== 'code_editor') throw new Error('Reset Layout: independent Source comparison required');
	await test.runPaletteCommand('Window: Move Editor To…');
	await test.clipboard.writeText('New Editor Window'); await press('ControlLeft', 'KeyV'); await press('Enter');
	const document = parts.partForGroup(parts.findGroup(comparison)!);
	check(document.kind === 'document', 'Reset Layout: the retained comparison view moves into a real independent editor part');
	const window = document.window!;
	await test.runPaletteCommand('Window: Snap Window Right');
	await test.runPaletteCommand('Window: Maximize Window');
	await test.runPaletteCommand('Window: Minimize Window');
	const groups = [...parts.groups], tabs = groups.map(group => [...group.model.tabs]), documents = [...parts.documents];
	check(window.model.minimized && main.activityWindow.model.minimized && main.regions.hierarchy.placement === 'floatingWindow'
		&& main.regions.details.placement === 'floatingWindow', 'Reset Layout: native commands establish independent nondefault placements');
	await test.runPaletteCommand('Workspace: Reset Layout'); await frame();
	check(main.primary === client && main.activity === activity && main.activityPlacement === 'dockedMain'
		&& main.regions.hierarchy.docked && main.regions.details.docked && client.hierarchy.attached && client.details.attached,
		'Reset Layout: native Palette returns the retained Main presentations to their default containers');
	check(window.isOpen && !window.model.minimized && window.model.placement === 'normal' && window.model.placementInitialized
		&& parts.documents.length === documents.length && parts.documents.every((part, index) => part === documents[index])
		&& parts.groups.length === groups.length && groups.every((group, index) => parts.groups.includes(group)
			&& group.model.tabs.length === tabs[index].length && group.model.tabs.every((input, tab) => input === tabs[index][tab])),
		'Reset Layout: default placement preserves independent editor parts, groups and exact input membership instead of merging tabs');
	await test.runPaletteCommand('Window: Show Open Windows');
	const picker = editor.quickInput;
	await test.clipboard.writeText(comparison.title); await press('ControlLeft', 'KeyV');
	const target = picker.model.list.rows.findIndex(row => (row.item as WindowChoice).window === window);
	check(target >= 0, 'Reset Layout: the same independent document window remains discoverable after resetting geometry');
	for (let row = 0; row < target; row++) await press('ArrowDown');
	await press('Enter');
	await test.runPaletteCommand('Window: Close Window');
	await test.until(() => document.retired, 'Reset Layout: explicit cleanup closes only the test-owned comparison view and empty shell');
	check(parts.findGroup(source) === sourceGroup && sourceGroup.model.contains(source) && !editor.actionPrompt.visible,
		'Reset Layout: closing the extra view leaves the canonical Source and primary consumer intact');
	if (!activityVisible) await test.runPaletteCommand('Workspace: Hide Activity Area');
	await test.runPaletteCommand('Workspace: Focus Details'); await press('Tab');
	const field = client.details.control.controls[0], generation = client.details.scope.contextGeneration;
	check(inputFocus.admittedTarget === field.field.focusTarget, 'Reset Layout: ordinary traversal reaches the actual Details field');
	await press('ControlLeft', 'KeyA'); await test.clipboard.writeText('34'); await press('ControlLeft', 'KeyV');
	check(field.pending && model.buffer.getText() === text, 'Reset Layout: the actual field owns a source draft before layout mutation');
	// Hybrid owning-boundary checkpoint: no artificial focus departure is inserted into a pure layout request.
	check(editor.resetLayout(), 'Reset Layout: the real workspace owner admits an unchanged focused body');
	await frame();
	check(inputFocus.admittedTarget === field.field.focusTarget && field.pending && field.field.text === '34'
		&& client.details.control.controls[0] === field && client.details.scope.contextGeneration === generation
		&& model.buffer.getText() === text && model.version === version,
		'Reset Layout: pure owner reset preserves the same native field, its local draft and canonical source generation');
	await press('Escape');
	if (!editor.menubar.expanded) await test.click(editorChromeState.menuButtonBounds);
	test.movePointer(editorChromeState.menuEntryBounds.window); await frame();
	await test.clickContextCommand('workspace.resetLayout'); await frame();
	check(!field.pending && main.primary === client && client.consumer.selectionRange.start === selected.start
		&& client.consumer.selectionRange.end === selected.end && model.buffer.getText() === text && model.version === version
		&& model.dirty === dirty && model.canUndo === undo && model.canRedo === redo
		&& test.cycles() === before && ide.sources.currentBlua32Media === media,
		'Reset Layout: the ordinary Window-menu route changes no authored selection, canonical history or execution attachment');
	await test.capture?.(`layout-reset-${editor.fontVariant}-theme-${theme}-main`);
	await testUtilityReset(test, client, source, theme);
	check(model.buffer.getText() === text && model.version === version && model.dirty === dirty && model.canUndo === undo && model.canRedo === redo
		&& test.cycles() === before && ide.sources.currentBlua32Media === media,
		'Reset Layout: utility default restoration neither edits source/history nor mutates the execution attachment');
	console.info(`STUDIO: Reset Layout ${editor.fontVariant} theme ${theme} PASS`);
}

/** A real dedicated-ROM inspector retains hidden window intent and reproduces defaults in the same font. */
async function testUtilityReset(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const { ide, press, frame } = test, editor = ide.editor, group = editor.editorParts.findGroup(source)!;
	await test.clickTab(source.id, 1, group);
	await test.runPaletteCommand('View: ROM Inspector');
	const picker = editor.quickInput, imagePicker = editor.editorParts.partForGroup(group).quickInput;
	const choices = imagePicker.model.items as readonly (QuickPickItem & { readonly snapshot: RomInspectorSnapshot })[];
	const image = ide.sources.cartridgeSlots[0]!.rom.bytes, index = choices.findIndex(choice => choice.snapshot.rom === image);
	check(imagePicker.visible && index >= 0, 'Reset Layout: utility admission selects the exact dedicated cartridge image in its receiving part');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	await press('Enter');
	const rom = group.model.activeTab;
	if (rom.kind !== 'rom_inspector') throw new Error('Reset Layout: actual ROM inspector required');
	await test.runPaletteCommand('ROM Inspector: Show Map Key');
	await test.runPaletteCommand('Window: Move Window'); await press('ArrowLeft'); await press('Enter');
	await test.clickTab(rom.id, 1, group);
	await test.runPaletteCommand('ROM Inspector: Browse Disassembly');
	await test.runPaletteCommand('ROM Inspector: Show Entry Inspector');
	await test.runPaletteCommand('ROM Inspector: Hold Entry');
	await test.runPaletteCommand('Window: Move Window'); await press('ArrowUp'); await press('Enter');
	const subject = rom.reader.subject, catalogSelection = rom.model.selection;
	check(subject !== undefined && rom.readerHeld && rom.keyWindow.placementInitialized && rom.readerWindow.placementInitialized,
		'Reset Layout: both actual utility windows have produced owner placement and the reader holds a real snapshot');
	await test.clickTab(source.id, 1, group);
	await test.runPaletteCommand('Workspace: Reset Layout'); await frame();
	check(rom.windowPlacements.every(model => !model.placementInitialized && model.open)
		&& rom.readerHeld && rom.reader.subject === subject && rom.model.selection === catalogSelection,
		'Reset Layout: an inactive input retains both subjects/open flags while its unpresented window defaults remain explicit pending intent');
	await test.clickTab(rom.id, 1, group); await frame();
	check(rom.windowPlacements.every(model => model.placementInitialized && model.open && model.placement === 'normal')
		&& rom.readerHeld && rom.reader.subject === subject && rom.model.selection === catalogSelection,
		'Reset Layout: reattaching in the same font materializes both current defaults without replacing the held observation');
	for (const model of rom.windowPlacements) {
		await test.runPaletteCommand('Window: Show Open Windows');
		const rows = picker.model.list.rows;
		const target = rows.findIndex(row => (row.item as WindowChoice).window?.model === model);
		check(target >= 0, 'Reset Layout: each real utility is discoverable after its deferred default placement resolves');
		for (let row = 0; row < target; row++) await press('ArrowDown');
		await press('Enter');
		await test.capture?.(`layout-reset-${editor.fontVariant}-theme-${theme}-${model === rom.keyWindow ? 'rom-key' : 'rom-reader'}`);
	}
	await test.clickTab(rom.id, 1, group); await press('ControlLeft', 'KeyW');
	await test.clickTab(source.id, 1, group);
	check(!group.model.contains(rom) && editor.mainWorkspace.primary === client && group.model.activeTab === source,
		'Reset Layout: explicit utility-document cleanup retires only its owned windows, not the existing Source or primary work');
}
