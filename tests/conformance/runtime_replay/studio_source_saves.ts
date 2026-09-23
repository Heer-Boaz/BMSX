import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { COLOR_STATUS_WARNING } from '../../../ide/common/constants';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { readLocalWorkspaceRecord, reconnectWorkspaceRecords, workspaceRecordState } from '../../../ide/workspace/records';
import { resolveWorkspacePath } from '../../../ide/workspace/path';
import { runtimeSourceProjectRootPath } from '../../../ide/runtime/sources';
import { check, type StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';

declare global {
	/** Playwright rejects only HTTP PUTs; successful reads/writes use the real file API. */
	var setStudioWorkspaceWriteFailure: (failed: boolean) => Promise<void>;
}

/** Automated source/command/UI evidence, not a claim of UI-only authoring. */
export async function runStudioSourceSaves(test: StudioFixture) {
	const { runtime, ide, execution, tasks, harness, clock, observations, frame, until, press, runMenuCommand, cycles, title } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'source saves: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const model = harness.getActiveEditorDocument().model;
	const root = runtimeSourceProjectRootPath(ide.sources, model.resource.domain);
	const path = resolveWorkspacePath(model.resource.path, root);
	const source = model.buffer.getText();
	const actor = title(), position = cycles(), media = ide.sources.currentBlua32Media;
	const files = workspaceRecordState.provider;
	harness.replaceActiveCodeSource(source + '\n-- project save acknowledged\n');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'source saves: project acknowledges first source');
	const firstSaved = model.lastSavedSource;
	check((await files.read(path))!.contents === firstSaved, 'source saves: saved means actual project bytes');
	check(!editorFeedbackState.message.text.includes('locally only'), 'source saves: acknowledged project save uses ordinary feedback');

	await globalThis.setStudioWorkspaceWriteFailure(true);
	harness.replaceActiveCodeSource(firstSaved + '-- local save acknowledged\n');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty && editorFeedbackState.message.text.includes('locally only'), 'source saves: rejected HTTP PUT reports local-only save');
	const localSaved = model.lastSavedSource;
	check(readLocalWorkspaceRecord(localStorage, root, path)!.contents === localSaved, 'source saves: local record contains the accepted revision');
	check((await files.read(path))!.contents === firstSaved, 'source saves: failed HTTP write did not update the project file');
	check(!workspaceRecordState.connected && editorFeedbackState.message.color === COLOR_STATUS_WARNING,
		'source saves: missing project acknowledgement is a visible warning');
	await frame();
	await test.capture?.('lua-local-only');
	harness.replaceActiveCodeSource(localSaved + '-- later unsaved typing\n');
	await globalThis.setStudioWorkspaceWriteFailure(false);
	await reconnectWorkspaceRecords(clock, root);
	check(workspaceRecordState.connected && (await files.read(path))!.contents === localSaved,
		'source saves: reconnect writes the saved revision, not later typing');
	check(model.dirty && model.lastSavedSource === localSaved, 'source saves: remote acknowledgement does not clean newer edits');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'source saves: later typing is explicitly saved');
	check((await files.read(path))!.contents === model.buffer.getText(), 'source saves: next Save acknowledges the new project bytes');
	check(!editorFeedbackState.message.text.includes('locally only'), 'source saves: successful retry replaces local-only warning');
	check(ide.sources.currentBlua32Media === media && title() === actor && cycles() === position,
		'source saves: source persistence does not install or run code');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'source saves: saved source remains separately unapplied');
	await frame();
	await test.capture?.('lua-project-saved');

	for (const kind of ['yaml', 'aem'] as const) {
		const resource = ide.sources.cartridgeSlots[0]!.dataResources.find(resource => kind === 'aem'
			? resource.source.type === 'aem'
			: resource.source.type === 'data' && resource.path.endsWith('nemesis_s_stage.yaml'))!;
		await ide.editor.navigation.openResource(resource);
		const document = harness.getActiveEditorDocument().model;
		check(document.mode === kind, `source saves: actual ${kind} source is editable`);
		const resourcePath = resolveWorkspacePath(resource.path, root);
		const before = (await files.read(resourcePath))!.contents;
		await globalThis.setStudioWorkspaceWriteFailure(true);
		document.pushEditOperations([{ offset: document.buffer.length, deleteLength: 0, text: '\n# source save acknowledgement\n' }]);
		await press('ControlLeft', 'KeyS');
		await until(() => tasks.ready && !document.dirty && editorFeedbackState.message.text.includes('locally only'),
			`source saves: ${kind} local acknowledgement reaches the command`);
		check((await files.read(resourcePath))!.contents === before, `source saves: ${kind} project remains unchanged after failed PUT`);
		check(readLocalWorkspaceRecord(localStorage, root, resourcePath)!.contents === document.buffer.getText(),
			`source saves: ${kind} saves authored bytes, not cooked data`);
		if (kind === 'aem') check(getTextFileRuntimeSourceStatus(ide.sources, document) === 'applied',
			'source saves: AEM can be applied while its project write is still pending');
		else check(cycles() === position, 'source saves: YAML persistence does not advance the machine');
		await frame();
		await test.capture?.(`${kind}-local-only`);
		await globalThis.setStudioWorkspaceWriteFailure(false);
		await reconnectWorkspaceRecords(clock, root);
		check((await files.read(resourcePath))!.contents === document.buffer.getText(), `source saves: ${kind} reconnect persists exact authored source`);
	}
	// AEM deliberately calls its real reload_from_rom function; that is guest
	// work, unlike Lua/YAML persistence, but does not reboot or resume gameplay.
	check(title() === actor && execution.userPaused, 'source saves: all formats retain the paused authoring machine');
	return { hostFrames: observations.hostFrames, formats: ['lua', 'yaml', 'aem'], sourceAcknowledgement: 'pass' };
}
