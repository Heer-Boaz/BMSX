import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { workspaceRecords } from '../../../ide/workspace/records';
import { resolveWorkspacePath } from '../../../ide/workspace/path';
import { check, type StudioFixture } from './studio_fixture';
import { nemesisTitle, reachNemesisTitle } from './studio_nemesis_navigation';

declare global {
	/** Playwright rejects only HTTP PUTs; successful reads/writes use the real file API. */
	var setStudioWorkspaceWriteFailure: (failed: boolean) => Promise<void>;
}

/** Automated source/command/UI evidence, not a claim of UI-only authoring. */
export async function runStudioSourceSaves(test: StudioFixture) {
	const { runtime, ide, execution, tasks, harness, observations, frame, until, press, runMenuCommand, cycles } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'source saves: boot real cartridge');
	await reachNemesisTitle(test);
	harness.openLuaSource('title_screen.lua');
	await frame();
	await runMenuCommand('pause');
	const model = harness.getActiveEditorDocument().model;
	const root = ide.sources.catalog.getContext(model.resource.contextId).projectRootPath;
	const path = resolveWorkspacePath(model.resource.path, root);
	const source = model.buffer.getText();
	const actor = nemesisTitle(test), position = cycles(), media = ide.sources.currentBlua32Media;
	const files = workspaceRecords.provider;
	harness.replaceActiveCodeSource(source + '\n-- project save acknowledged\n');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'source saves: project acknowledges first source');
	const firstSaved = model.lastSavedSource;
	check((await files.read(path))!.contents === firstSaved, 'source saves: saved means actual project bytes');

	await globalThis.setStudioWorkspaceWriteFailure(true);
	harness.replaceActiveCodeSource(firstSaved + '-- retain failed save\n');
	await press('ControlLeft', 'KeyS');
	await until(() => ide.textFileSaves.latestOperation(model)?.result?.status === 'failed', 'source saves: rejected HTTP PUT reports failed save');
	check(model.dirty && model.lastSavedSource === firstSaved, 'source saves: failed write retains dirty identity and previous canonical baseline');
	check((await files.read(path))!.contents === firstSaved, 'source saves: failed HTTP write did not update the project file');
	check(editorFeedbackState.message.kind === 'error', 'source saves: failed write is a visible error');
	await frame();
	await test.capture?.('lua-save-failed');
	harness.replaceActiveCodeSource(model.buffer.getText() + '-- later unsaved typing\n');
	await globalThis.setStudioWorkspaceWriteFailure(false);
	check((await files.read(path))!.contents === firstSaved, 'source saves: reading never replays a failed write');
	check(model.dirty && model.lastSavedSource === firstSaved, 'source saves: availability cannot acknowledge unsaved edits');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'source saves: later typing is explicitly saved');
	check((await files.read(path))!.contents === model.buffer.getText(), 'source saves: next Save acknowledges the new project bytes');
	check(ide.sources.currentBlua32Media === media && nemesisTitle(test) === actor && cycles() === position,
		'source saves: source persistence does not install or run code');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'source saves: saved source remains separately unapplied');
	await frame();
	await test.capture?.('lua-project-saved');

	for (const kind of ['yaml', 'aem'] as const) {
		const resource = ide.sources.catalog.resources.find(resource => resource.contextId === test.ide.sources.currentBlua32Media.cartridgeSlots[0]!.sourceContextId && (kind === 'aem'
			? resource.source.type === 'aem'
			: resource.source.type === 'data' && resource.path.endsWith('nemesis_s_stage.yaml')))!;
		await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), resource);
		if (kind === 'aem') {
			await frame();
			const input = ide.editor.editorParts.activeGroup.model.activeTab;
			if (input.kind !== 'aem_editor') throw new Error('source saves: actual audio event editor required');
			const original = input.workingCopy.buffer.getText();
			const index = input.tree.rows.findIndex(row => row.element.path.length === 2 && row.element.path[0] === 'events');
			const event = input.tree.rows[index].element;
			const layout = input.tree.layout, top = layout.contentTop + (index - input.tree.scroll) * layout.rowHeight;
			await test.click({ left: layout.contentLeft, right: layout.contentRight, top, bottom: top + layout.rowHeight });
			await press('Delete');
			check(input.document !== undefined && !input.document.hasIn(event.path),
				'source saves: deleting the first authored audio event leaves a valid document without that event');
			await test.capture?.('aem-first-event-removed');
			await press('ControlLeft', 'KeyZ');
			check(input.workingCopy.buffer.getText() === original, 'source saves: audio event Undo restores every authored byte');
			await test.runPaletteCommand('Audio Events: Open Source');
		}
		const document = harness.getActiveEditorDocument().model;
		check(document.mode === kind, `source saves: actual ${kind} source is editable`);
		const resourcePath = resolveWorkspacePath(resource.path, root);
		const before = (await files.read(resourcePath))!.contents;
		await globalThis.setStudioWorkspaceWriteFailure(true);
		document.pushEditOperations([{ offset: document.buffer.length, deleteLength: 0, text: '\n# source save acknowledgement\n' }]);
		await press('ControlLeft', 'KeyS');
		await until(() => ide.textFileSaves.latestOperation(document)?.result?.status === 'failed',
			`source saves: ${kind} write failure reaches the command`);
		check(document.dirty && tasks.ready, `source saves: ${kind} remains unsaved without running asset application`);
		check((await files.read(resourcePath))!.contents === before, `source saves: ${kind} project remains unchanged after failed PUT`);
		check(cycles() === position, 'source saves: rejected persistence does not advance the machine');
		await frame(); await test.capture?.(`${kind}-save-failed`);
		await globalThis.setStudioWorkspaceWriteFailure(false);
		await press('ControlLeft', 'KeyS');
		await until(() => ide.textFileSaves.latestOperation(document)?.result?.status === 'saved', `source saves: ${kind} retry is acknowledged`);
		check((await files.read(resourcePath))!.contents === document.buffer.getText(), `source saves: ${kind} explicit retry persists exact authored source`);
		if (kind === 'aem') {
			const saved = ide.textFileSaves.latestOperation(document)!.result!;
			check(saved.status === 'saved' && saved.application.status === 'not-requested', 'source saves: persistence never requests runtime application');
			check(ide.sources.currentBlua32Media === media, 'source saves: saving AEM preserves the installed generation');
			await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), resource); await frame();
			const aem = ide.editor.editorParts.activeGroup.model.activeTab;
			if (aem.kind !== 'aem_editor') throw new Error('source saves: explicit Apply belongs to the actual AEM input');
			await test.runPaletteCommand('Audio Events: Apply to Installed Attachment'); await press('Enter');
			await until(() => !aem.applying && getTextFileRuntimeSourceStatus(ide.sources, document) === 'applied', 'source saves: explicit named attachment Apply succeeds');
			check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('title_screen') === source
				&& ide.sources.cartridgeBlua32MediaDirty[0] && getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending',
				'Explicit AEM Apply relinks installed Lua without installing separately saved code');
			const validSource = document.buffer.getText(), installedMedia = ide.sources.currentBlua32Media;
			const invalidSource = 'events: [';
			document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: invalidSource }]);
			await press('ControlLeft', 'KeyS');
			await until(() => ide.textFileSaves.latestOperation(document)?.result?.status === 'saved', 'source saves: invalid source persists independently of runtime build');
			const rejected = ide.textFileSaves.latestOperation(document)!.result!;
			check(rejected.status === 'saved' && rejected.snapshot.source === invalidSource && rejected.application.status === 'not-requested',
				'source saves: invalid text is acknowledged without an implicit runtime build');
			check(!document.dirty && (await files.read(resourcePath))!.contents === invalidSource && ide.sources.currentBlua32Media === installedMedia,
				'source saves: exact authored bytes persist while the installed image stays unchanged');
			await test.runPaletteCommand('Audio Events: Apply to Installed Attachment'); await press('Enter');
			await until(() => !aem.applying && getTextFileRuntimeSourceStatus(ide.sources, document) === 'failed', 'source saves: explicit Apply rejects invalid AEM');
			check(tasks.ready && tasks.failure === undefined && ide.sources.currentBlua32Media === installedMedia,
				'source saves: rejected Apply leaves installed media and the runtime queue intact');
			await frame(); await test.capture?.('aem-build-rejected-source-saved');
			document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: validSource }]);
			await press('ControlLeft', 'KeyS');
			await until(() => ide.textFileSaves.latestOperation(document)?.result?.status === 'saved', 'source saves: correction persists through the same source owner');
			await test.runPaletteCommand('Audio Events: Apply to Installed Attachment'); await press('Enter');
			await until(() => !aem.applying && getTextFileRuntimeSourceStatus(ide.sources, document) === 'applied', 'source saves: corrected explicit Apply succeeds');
			check(!document.dirty && tasks.ready, 'source saves: persistence and explicit application finish independently');
		}
		await frame(); await test.capture?.(`${kind}-project-saved`);
	}
	// AEM deliberately calls its real reload_from_rom function; that is guest
	// work, unlike Lua/YAML persistence, but does not reboot or resume gameplay.
	check(nemesisTitle(test) === actor && execution.userPaused, 'source saves: all formats retain the paused authoring machine');
	return { hostFrames: observations.hostFrames, formats: ['lua', 'yaml', 'aem'], sourceAcknowledgement: 'pass' };
}
