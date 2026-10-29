import type { CommandQuickPickItem } from '../../../ide/workbench/contrib/commands/quick_pick_provider';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { RomInspectorSnapshot } from '../../../ide/workbench/contrib/rom_inspector/model';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

const MODES = ['romInspector.assets', 'romInspector.structure', 'romInspector.code'] as const;

/** Native checked capabilities belong to the invoking pane/reader, never its background document. */
export async function testStudioRomCommands(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput): Promise<void> {
	const editor = test.ide.editor, group = editor.editorParts.findGroup(source)!;
	const media = test.ide.sources.currentBlua32Media, cycles = test.cycles(), selection = client.consumer.selection;
	const model = source.workingCopy, text = model.buffer.getText(), version = model.version;
	const dirty = model.dirty, undo = model.canUndo, redo = model.canRedo;
	await test.runPaletteCommand('View: ROM Inspector');
	const picker = editor.quickInput, imagePicker = editor.editorParts.partForGroup(group).quickInput;
	const choices = imagePicker.model.items as readonly (QuickPickItem & { readonly snapshot: RomInspectorSnapshot })[];
	const image = test.ide.sources.cartridgeSlots[0]!.rom.bytes;
	const index = choices.findIndex(choice => choice.snapshot.rom === image);
	check(index >= 0, 'ROM commands: the dedicated cartridge supplies the exact installed packed snapshot');
	for (let item = 0; item < index; item++) await test.press('ArrowDown');
	await test.press('Enter');
	const rom = group.model.activeTab;
	if (rom?.kind !== 'rom_inspector') throw new Error('ROM commands: ordinary image choice must admit the native pane');
	check(rom.snapshot.rom === image && group.model.contains(source),
		'ROM commands: snapshot admission retains its exact media and the independent canonical Source');
	let checkedMenus = 0;
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('ROM Inspector: Browse Disassembly');
			const catalog = inputFocus.admittedTarget!;
			check(rom.model.mode === 'code' && MODES.every(command => editor.commands.isActive(command, catalog) === (command === 'romInspector.code')),
				'ROM commands: the actual catalog exposes exactly its selected native mode');
			await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			check(picker.invocationOrigin === catalog && (picker.model.items as readonly CommandQuickPickItem[])
				.some(item => item.command === 'romInspector.code') && editor.commands.isActive('romInspector.code', picker.invocationOrigin),
				'ROM commands: Palette retains the actual catalog capability and checked mode');
			await test.press('Escape');
			if (rom.actions.items.find(item => item.command === 'romInspector.code')!.overflowed) {
				await test.click(rom.actions.overflow!.button.bounds);
				check(editor.contextMenu.visible && editor.contextMenu.model.rows.some(row => row.command === 'romInspector.code' && row.enabled && row.active)
					&& editor.contextMenu.model.rows.every(row => !MODES.some(command => command === row.command) || row.active === (row.command === 'romInspector.code')),
					'ROM commands: the actual overflow popup checks only its native selected mode');
				checkedMenus++;
				await test.capture?.(`rom-command-${editor.fontVariant}-theme-${theme}-checked-menu`);
				await test.press('Escape');
			}
			await test.runPaletteCommand('ROM Inspector: Show Entry Inspector');
			const reader = inputFocus.admittedTarget!, subject = rom.reader.subject;
			check(subject !== undefined && !rom.readerHeld && !editor.commands.isActive('romInspector.hold', reader),
				'ROM commands: a fresh native reader follows the exact selected entry');
			await test.runPaletteCommand('ROM Inspector: Hold Entry');
			check(rom.readerHeld && rom.reader.subject === subject && editor.commands.isActive('romInspector.hold', reader)
				&& rom.readerActions.items.find(item => item.command === 'romInspector.hold')!.checked,
				'ROM commands: accepted Hold checks both the reader capability and its visible pin action');
			await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			check(picker.invocationOrigin === reader && (picker.model.items as readonly CommandQuickPickItem[])
				.some(item => item.command === 'romInspector.hold') && editor.commands.isActive('romInspector.hold', picker.invocationOrigin),
				'ROM commands: Palette observes the held entry through the exact invoking reader');
			await test.press('Escape');
			await test.capture?.(`rom-command-${editor.fontVariant}-theme-${theme}-held-reader`);
			await test.runPaletteCommand('Workspace: Focus Hierarchy');
			const hierarchy = inputFocus.admittedTarget!;
			check(client.hierarchy.scope.contains(hierarchy.scope) && group.model.activeTab === rom
				&& [...MODES, 'romInspector.hold' as const].every(command => !editor.commands.isActive(command, hierarchy)),
				'ROM commands: Main never inherits a background catalog mode or held reader');
			await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			check(picker.invocationOrigin === hierarchy && (picker.model.items as readonly CommandQuickPickItem[])
				.every(item => !item.command.startsWith('romInspector.')),
				'ROM commands: the unrelated Main Palette offers no background ROM capability');
			await test.press('Escape');
			await test.clickTab(source.id, 1, group);
			check(rom.readerWindow.open && !editor.commands.isEnabled('romInspector.hold', reader) && !editor.commands.isActive('romInspector.hold', reader),
				'ROM commands: a retained open flag cannot admit a detached reader capability');
			await test.clickTab(rom.id, 1, group);
			await test.runPaletteCommand('ROM Inspector: Show Entry Inspector');
			await test.runPaletteCommand('ROM Inspector: Follow Selection');
			check(!rom.readerHeld && !editor.commands.isActive('romInspector.hold', inputFocus.admittedTarget),
				'ROM commands: reattached reader publishes its own current Follow state');
			await test.click(rom.readerActions.items.find(item => item.command === 'window.hide')!.bounds);
			check(!rom.readerWindow.open, 'ROM commands: the reader close action retires its actual window');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	check(checkedMenus > 0, 'ROM commands: the real narrow document toolbar exercises checked popup presentation');
	await test.press('ControlLeft', 'KeyW');
	await test.clickTab(source.id, 1, group);
	check(!group.model.contains(rom) && editor.mainWorkspace.primary === client && client.consumer.selection === selection
		&& model.buffer.getText() === text && model.version === version && model.dirty === dirty && model.canUndo === undo && model.canRedo === redo
		&& test.ide.sources.currentBlua32Media === media && test.cycles() === cycles,
		'ROM commands: native checked-state routing preserves primary selection, canonical Source history and guest execution');
}
