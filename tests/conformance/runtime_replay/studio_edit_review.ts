import { HostPauseReason } from '../../../hosts/common/execution_control';
import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { check, type StudioFixture } from './studio_fixture';

/** Automated setup; review/accept/discard/Undo use visible production controls. */
export async function runStudioEditReview(test: StudioFixture) {
	const { ide, runtime, harness, until, frame, press, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'edit review: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('cart.lua');
	await frame();
	await test.runMenuCommand('pause');
	const main = harness.getActiveEditorDocument().model, mainTab = getActiveTab();
	const originalMain = main.buffer.getText();
	const record = runtimeLuaSourceRegistry(ide.sources, 0)!.records.find(record => record.program_module
		&& !record.generated && record.source_path !== main.resource.path && !record.module_path.startsWith('cartlib/'))!;
	harness.openLuaSource(record.source_path);
	const provider = harness.getActiveEditorDocument().model, providerTab = getActiveTab();
	const originalProvider = provider.buffer.getText();
	const mainText = 'return fixture_rename, fixture_rename';
	const providerText = 'fixture_rename = { value = 1 }\n'
		+ Array.from({ length: 40 }, (_, index) => `local review_value_${index} = fixture_rename`).join('\n') + '\nreturn fixture_rename';
	main.pushEditOperations([{ offset: 0, deleteLength: main.buffer.length, text: mainText }]);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: providerText }]);
	const media = ide.sources.currentBlua32Media;
	const show = async () => {
		await test.clickTab(mainTab.id);
		await press('ControlLeft', 'End'); await press('ArrowLeft');
		await runPaletteCommand('Edit: Rename Symbol with Preview');
		test.clipboard.text = 'fixture_reviewed';
		await press('ControlLeft', 'KeyV'); await press('Enter');
		const input = getActiveTab();
		if (input.kind !== 'workspace_edit_review') throw new Error('edit review: production review pane expected');
		check(activeCodeEditor.model === null && input.proposal.files.length === 2,
			'edit review: resource-based pane detaches the code widget and shows both sources');
		check(main.buffer.getText() === mainText && provider.buffer.getText() === providerText,
			'edit review: preparing a proposal does not edit the source');
		return input;
	};
	const review = await show();
	await frame(); await test.capture?.('pending');
	await press('End');
	check(review.viewport.scrollTop > 0, 'edit review: keyboard can reach changes below the first viewport');
	await frame(); await test.capture?.('last-file');
	ide.editor.setFontVariant('msx'); await frame();
	await press('Home'); await test.capture?.('msx');
	ide.editor.setFontVariant('tiny'); await frame(); await frame();
	const rows = review.rows;
	const identities = rows.slice();
	const position = cycles();
	test.execution.setPauseReason(HostPauseReason.Requested, false);
	await until(() => cycles() > position, 'edit review: host-only review lets guest execution continue');
	test.execution.setPauseReason(HostPauseReason.Requested, true);
	check(rows.every((row, index) => row === identities[index]), 'edit review: unchanged frames reuse all projected rows');
	await runPaletteCommand('Review: Apply Workspace Edit');
	check(review.proposal.state === 'applied' && main.buffer.getText() === mainText.replaceAll('fixture_rename', 'fixture_reviewed')
		&& provider.buffer.getText() === providerText.replaceAll('fixture_rename', 'fixture_reviewed'), 'edit review: one visible Apply changes both working copies');
	check(main.lastSavedSource === originalMain && provider.lastSavedSource === originalProvider && ide.sources.currentBlua32Media === media,
		'edit review: Apply neither saves nor installs source');
	check(!ide.editor.commands.isEnabled('workspaceEditReview.apply'), 'edit review: applied proposals cannot run twice');
	await frame(); await test.capture?.('applied');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === mainText && provider.buffer.getText() === providerText, 'edit review: ordinary source Undo restores both files');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyY');
	check(main.buffer.getText().includes('fixture_reviewed') && provider.buffer.getText().includes('fixture_reviewed'), 'edit review: joint Redo from the other file');
	await press('ControlLeft', 'KeyZ');
	const discarded = await show();
	await test.click(discarded.actionBar.items.find(item => item.command === 'workspaceEditReview.discard')!.bounds);
	check(discarded.proposal.state === 'discarded' && main.buffer.getText() === mainText, 'edit review: pointer Discard does not mutate source');
	const stale = await show();
	await test.clickTab(providerTab.id); await press('ControlLeft', 'End');
	test.clipboard.text = '\n-- later edit'; await press('ControlLeft', 'KeyV');
	await test.clickTab(stale.id);
	check(stale.proposal.state === 'stale' && !ide.editor.commands.isEnabled('workspaceEditReview.apply'),
		'edit review: editing another tab retires the pending proposal');
	await frame(); await test.capture?.('stale');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ');
	const transient = await show();
	const serialized = editorTabGroup.serialize(ide.editor.editorInputSerializers);
	check(serialized.inputs.every(input => input.kind !== ('workspace_edit_review' as string)), 'edit review: session never serializes edit rights');
	await press('ControlLeft', 'KeyW');
	check(transient.proposal.state === 'discarded', 'edit review: Close discards the unaccepted proposal');
	await test.clickTab(providerTab.id); await press('ControlLeft', 'KeyZ');
	await test.clickTab(mainTab.id); await press('ControlLeft', 'KeyZ');
	check(main.buffer.getText() === originalMain && provider.buffer.getText() === originalProvider, 'edit review: fixture cleanup uses ordinary source history');
	check(ide.sources.currentBlua32Media === media, 'edit review: installed media is unchanged');
	return { hostFrames: test.observations.hostFrames, review: 'pass', files: review.proposal.files.length, guestCycles: cycles() };
}
