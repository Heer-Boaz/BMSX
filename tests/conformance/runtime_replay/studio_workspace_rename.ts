import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { renameController } from '../../../ide/workbench/contrib/code_editor/rename/controller';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { check, type StudioFixture } from './studio_fixture';

/** Independent authored fixture; acceptance, history and conflicts use real focused controls. */
export async function testStudioWorkspaceRename(test: StudioFixture): Promise<void> {
	const { ide, harness, press, runPaletteCommand, cycles } = test;
	console.info('STUDIO: multi-resource Rename and shared Undo/Redo');
	harness.openLuaSource('cart.lua');
	const main = harness.getActiveEditorDocument().model;
	const mainTab = getActiveTab();
	const originalMain = main.buffer.getText();
	const providerSource = runtimeLuaSourceRegistry(ide.sources, main.resource.domain)!.records.find(record =>
		record.program_module && !record.generated && record.source_path !== main.resource.path && !record.module_path.startsWith('cartlib/'))!;
	harness.openLuaSource(providerSource.source_path);
	const provider = harness.getActiveEditorDocument().model;
	const providerTab = getActiveTab();
	const originalProvider = provider.buffer.getText();
	const mainText = 'return fixture_rename, fixture_rename';
	const providerText = 'fixture_rename = { value = 1 }\nreturn fixture_rename';
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: providerText }]);
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length, text: mainText }]);
	const position = cycles(), media = ide.sources.currentBlua32Media;
	await test.clickTab(mainTab.id);
	await press('ControlLeft', 'End'); await press('ArrowLeft');
	await runPaletteCommand('Edit: Rename Symbol');
	check(renameController.isActive() && renameController.getOriginalName() === 'fixture_rename', 'workspace rename: actual semantic reference opens the prompt');
	test.clipboard.text = 'fixture_renamed';
	await press('ControlLeft', 'KeyV'); await press('Enter');
	check(main.buffer.getText() === mainText.replaceAll('fixture_rename', 'fixture_renamed')
		&& provider.buffer.getText() === providerText.replaceAll('fixture_rename', 'fixture_renamed'), 'workspace rename: one command edits both actual source owners');
	check(harness.getActiveEditorDocument().view.cursorColumn === 'return fixture_renamed, '.length,
		'workspace rename: selection accounts for the earlier replacement on the same line');
	await test.clickTab(providerTab.id);
	await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === mainText && provider.buffer.getText() === providerText, 'workspace rename: provider Undo restores both sources');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyY');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'End');
	test.clipboard.text = '\n-- later'; await press('ControlLeft', 'KeyV');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyZ');
	check(editorFeedbackState.message.text.includes('Cannot undo across files') && main.buffer.getText().includes('fixture_renamed')
		&& provider.buffer.getText().endsWith('-- later'), 'workspace rename: focused Undo reports its actual dependency and changes neither source');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === mainText && provider.buffer.getText() === providerText, 'workspace rename: Undo succeeds after the intervening edit is undone');
	await test.clickTab(mainTab.id);
	await press('ControlLeft', 'End'); await press('ArrowLeft');
	await runPaletteCommand('Edit: Rename Symbol');
	provider.pushEditOperations([{ offset: provider.buffer.length, deleteLength: 0, text: '\n-- external edit' }]);
	check(!renameController.isActive() && !renameController.isVisible() && main.buffer.getText() === mainText,
		'workspace rename: changing a workspace source dismisses the retained semantic proposal');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === originalMain && provider.buffer.getText() === originalProvider, 'workspace rename: fixture cleanup uses retained source history');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'workspace rename: no guest execution or source installation');
}
