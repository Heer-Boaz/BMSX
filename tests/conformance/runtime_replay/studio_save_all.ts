import { inputFocus } from '../../../ide/input/focus';
import { workspaceRecords } from '../../../ide/workspace/records';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { ResourceQuickPickItem } from '../../../ide/workbench/contrib/resources/quick_access';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { check, type StudioFixture } from './studio_fixture';
import { openSceneFixture } from './studio_scene_source';

/** Ordinary editing and Save All address canonical working copies, independently of document presentation. */
export async function testStudioSaveAll(test: StudioFixture): Promise<void> {
	const { ide } = test, editor = ide.editor, parts = editor.editorParts, panel = editor.resourcePanel;
	const { model, resource, close } = await openSceneFixture(test, 'save-all', [
		['save_alpha.lua', 'return { alpha = true }\n'], ['save_beta.lua', 'return { beta = true }\n'],
	]);
	await close();
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await test.frame();
	await test.press('ArrowRight'); await test.press('ArrowDown'); await test.press('ContextMenu');
	await test.clickContextCommand('resources.open');
	const primary = editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('Save All: the synthetic Scene must own its actual Main presentation');
	await test.press('ArrowDown'); await test.press('Enter'); await test.press('Home');
	const alpha = ide.sources.catalog.resolveResource({ contextId: resource.contextId, path: 'save_alpha.lua' })!;
	const beta = ide.sources.catalog.resolveResource({ contextId: resource.contextId, path: 'save_beta.lua' })!;
	const views: CodeEditorInput[] = [];
	for (const [file, beside] of [[alpha, false], [alpha, true], [beta, false]] as const) {
		const previousGroup = parts.activeGroup;
		await test.runPaletteCommand('Go: Go to File');
		await test.clipboard.writeText(file.path); await test.press('ControlLeft', 'KeyV');
		const index = editor.quickInput.model.list.rows.findIndex(row => (row.item as ResourceQuickPickItem).resource === file);
		check(index >= 0, 'Save All: Go to File offers the exact synthetic source owner');
		for (let row = 0; row < index; row++) await test.press('ArrowDown');
		if (beside) await test.press('AltLeft', 'Enter'); else await test.press('Enter');
		await test.until(() => parts.activeGroup.model.activeTab?.resource === file
			&& (!beside || parts.activeGroup !== previousGroup)
			&& inputFocus.admittedTarget === parts.activeGroup.panes.activePane?.commandTarget,
			'Save All: ordinary file intent completes in its actual independent document presentation');
		const input = parts.activeGroup.model.activeTab;
		if (input?.kind !== 'code_editor') throw new Error('Save All: source intent must admit a real text view');
		views.push(input);
	}
	const [alphaView, duplicate, betaView] = views, mainGroup = parts.findGroup(alphaView)!, side = parts.findGroup(betaView)!;
	check(alphaView !== duplicate && parts.findGroup(duplicate) === side && side !== mainGroup
		&& alphaView.workingCopy === duplicate.workingCopy && side.model.activeTab === betaView
		&& parts.groups.every(group => group.model.tabs.every(input => input.resource !== resource)),
		'Save All: inactive and duplicate Source views share one model, while Main has no document view');
	await test.runPaletteCommand('View: Focus Files'); await test.press('Home');
	check(panel.files.selectedNode?.element.kind === 'root',
		'Save All: ordinary Files navigation establishes independent container-reading intent, not an edited declaration fingerprint');
	const media = ide.sources.currentBlua32Media, cycles = test.cycles(), boot = ide.boots.latestOperation;
	const hotResume = ide.hotResumes.latestOperation, target = ide.runTargets.selected;
	const activity = editor.mainWorkspace.activity, activityDisplayed = editor.mainWorkspace.activityDisplayed;
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			const step = font * 2 + theme;
			await test.runPaletteCommand('Window: Focus Main Workspace');
			await test.runPaletteCommand('Editor Groups: Focus Previous Group');
			check(parts.activeGroup === mainGroup && mainGroup.model.activeTab === alphaView,
				'Save All: native group navigation reveals the canonical alpha view before editing');
			await test.press('ControlLeft', 'End'); await test.clipboard.writeText(`\n-- alpha Save All ${step}\n`); await test.press('ControlLeft', 'KeyV');
			await test.runPaletteCommand('Editor Groups: Focus Next Group');
			check(parts.activeGroup === side && side.model.activeTab === betaView,
				'Save All: native group navigation edits beta without activating its inactive alpha duplicate');
			await test.press('ControlLeft', 'End'); await test.clipboard.writeText(`\n-- beta Save All ${step}\n`); await test.press('ControlLeft', 'KeyV');
			await test.runPaletteCommand('Workspace: Focus Details');
			await test.click(primary.view.details.properties[0].bounds); await test.press('ControlLeft', 'KeyA');
			const mainVersion = model.version, previousMainSave = ide.textFileSaves.latestOperation(model);
			await test.clipboard.writeText(String(12 + step)); await test.press('ControlLeft', 'KeyV');
			const draft = primary.details.control.controls[0];
			const sources = [alphaView.workingCopy, betaView.workingCopy].map(workingCopy => ({ workingCopy,
				source: workingCopy.buffer.getText(), version: workingCopy.version, undo: workingCopy.canUndo, redo: workingCopy.canRedo,
				previous: ide.textFileSaves.latestOperation(workingCopy) }));
			check(draft.pending && model.version === mainVersion && sources.every(entry => entry.workingCopy.dirty)
				&& alphaView.workingCopy === duplicate.workingCopy
				&& side.model.activeTab === betaView && parts.groups.every(group => group.model.tabs.every(input => input.resource !== resource)),
				'Save All: native editing retains an uncommitted Main draft without a Source tab and two dirty sources with an inactive duplicate');
			const selection = primary.consumer.selectionRevision, files = JSON.stringify(panel.serialize());
			const groups = parts.groups.map(group => ({ group, active: group.model.activeTab, inputs: [...group.model.tabs] }));
			if (step === 0 || step === 3) {
				await test.press('F10');
				check(editor.menubar.activeMenu === 'file' && editor.contextMenu.model.rows.some(row => row.command === 'saveAll' && row.enabled),
					'Save All: the real File menu admits the workspace operation from independent Main focus');
				await test.capture?.(`save-all-${editor.fontVariant}-theme-${theme}-file-menu`);
				await test.clickContextCommand('saveAll');
			} else if (step === 1) await test.runPaletteCommand('File: Save All');
			else {
				await test.press('ControlLeft', 'KeyK');
				check(editor.keybindings.inChordMode, 'Save All: the native workspace shortcut owns its chord before the final stroke');
				await test.press('KeyS');
				check(!editor.keybindings.inChordMode, 'Save All: the unmodified final stroke completes the workspace shortcut');
			}
			check(!draft.pending && model.version === mainVersion + 1,
				'Save All: ordinary menu blur or command draft admission publishes the focused Main edit exactly once');
			const saved = [{ workingCopy: model, source: model.buffer.getText(), version: model.version,
				undo: model.canUndo, redo: model.canRedo, previous: previousMainSave }, ...sources];
			await test.until(() => saved.every(entry => ide.textFileSaves.latestOperation(entry.workingCopy) !== entry.previous
				&& ide.textFileSaves.latestOperation(entry.workingCopy)?.result?.status === 'saved'),
				'Save All: the real source owner acknowledges all admitted dirty working copies');
			for (const entry of saved) {
				const operation = ide.textFileSaves.latestOperation(entry.workingCopy)!;
				const record = await workspaceRecords!.provider.read(entry.workingCopy.resource.sourceFilePath!);
				// Exact persisted source is a data-integrity contract, not incidental UI wording.
				check(operation.snapshot.source === entry.source && operation.snapshot.version === entry.version
					&& record!.contents === entry.source && !entry.workingCopy.dirty && entry.workingCopy.lastSavedSource === entry.source
					&& entry.workingCopy.persistedBaseline === entry.source
					&& entry.workingCopy.buffer.getText() === entry.source && entry.workingCopy.version === entry.version
					&& entry.workingCopy.canUndo === entry.undo && entry.workingCopy.canRedo === entry.redo,
					'Save All: canonical acknowledgement matches actual filesystem bytes without replacing source or history');
			}
			check(parts.groups.length === groups.length && groups.every(entry => parts.groups.includes(entry.group)
				&& entry.group.model.activeTab === entry.active && entry.group.model.tabs.length === entry.inputs.length
				&& entry.group.model.tabs.every((input, index) => input === entry.inputs[index])),
				'Save All: persistence keeps exact group and document-input topology');
			check(editor.mainWorkspace.primary === primary && primary.consumer.selectionRevision === selection,
				'Save All: persistence keeps the actual Main subject and selection intent');
			check(editor.mainWorkspace.activity === activity && editor.mainWorkspace.activityDisplayed === activityDisplayed,
				'Save All: persistence keeps the independent activity presentation');
			check(JSON.stringify(panel.serialize()) === files, 'Save All: persistence keeps Files selection and reading state');
			check(ide.sources.currentBlua32Media === media && test.cycles() === cycles
				&& ide.boots.latestOperation === boot && ide.hotResumes.latestOperation === hotResume && ide.runTargets.selected === target,
				'Save All: source persistence never boots, applies or executes guest code');
			await test.capture?.(`save-all-${editor.fontVariant}-theme-${theme}-saved`);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.runPaletteCommand('Editor: Close All Editors'); await test.runPaletteCommand('Workspace: Clear Primary Authoring');
	await test.runPaletteCommand('Window: Focus Main Workspace'); await test.runPaletteCommand('Editor Groups: Close Group');
	await close();
}
