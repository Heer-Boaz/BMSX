import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { findCodeTabContext } from '../../../ide/workbench/ui/code_tab/contexts';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { workspaceState } from '../../../ide/workbench/workspace/state';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Reported real-cart smoke; collection/lifecycle regressions use independent unit fixtures. */
export async function testStudioSourceRecovery(test: StudioFixture): Promise<void> {
	const { ide, runPaletteCommand, press, click, frame, until, cycles } = test;
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT enemy_crossfoe', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('crossfoe: concrete BT graph required');
	const model = lens.workingCopy;
	const graph = lens.view.presentation;
	const original = model.buffer.getText();
	check(!model.dirty && !model.canUndo && findCodeTabContext(model.resource) === null, 'crossfoe: clean Lens model exists without a code view');
	await press('ArrowDown');
	await press('ArrowDown');
	await runPaletteCommand('Behavior Lens: Move BT Child Later');
	check(model.dirty && model.buffer.getText() !== original, 'crossfoe: only an explicit source command edits the BT');
	await until(() => workspaceState.localRevision === workspaceState.requestedRevision, 'crossfoe: real autosave timer backs up the visual edit');
	const backup = workspaceState.localGeneration!;
	check(backup.payload.dirtyFiles.some(entry => entry.path === model.resource.path)
		&& !backup.payload.codeEditorViews.some(entry => entry.path === model.resource.path), 'crossfoe: a valid content backup need not have a code view');
	const editedVersion = model.version;
	await click(graph.actionBar.items[0].bounds, 8);
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model && model.version === editedVersion && !hasSelection(),
		'crossfoe: first Source activation attaches the same edited model without another edit');
	await until(() => workspaceState.localRevision === workspaceState.requestedRevision, 'crossfoe: first code-view metadata survives the autosave timer');
	const sourceGeneration = workspaceState.localGeneration!;
	check(sourceGeneration.dirtyRecords === backup.dirtyRecords && sourceGeneration.payload.dirtyFiles === backup.payload.dirtyFiles,
		'crossfoe: navigation does not rewrite the dirty source backup');
	check(sourceGeneration.payload.codeEditorViews.some(entry => entry.path === model.resource.path
		&& entry.cursorRow === activeCodeEditor.view.cursorRow && entry.cursorColumn === activeCodeEditor.view.cursorColumn),
		'crossfoe: recovery now includes the first code view and its exact source selection');
	await press('ControlLeft', 'KeyZ');
	check(!model.dirty && model.buffer.getText() === original, 'crossfoe: ordinary document Undo restores the clean source');
	await until(() => workspaceState.localRevision === workspaceState.requestedRevision, 'crossfoe: clean source removes its recovery backup');
	const cleanVersion = model.version;
	let navigationEdits = 0;
	const unsubscribe = model.onDidChangeContent(() => navigationEdits += 1);
	for (const route of ['source', 'enter', 'double-click', 'details'] as const) {
		await test.clickTab(lens.id);
		if (route === 'source') await click(graph.actionBar.items[0].bounds, 8);
		else if (route === 'enter') await press('Enter');
		else if (route === 'double-click') {
			const viewport = graph.viewport;
			const selected = viewport.selection!;
			const bounds = { left: selected.bounds.left + viewport.bounds.left - viewport.scrollX,
				right: selected.bounds.right + viewport.bounds.left - viewport.scrollX,
				top: selected.bounds.top + viewport.bounds.top - viewport.scrollY,
				bottom: selected.bounds.bottom + viewport.bounds.top - viewport.scrollY };
			await click(bounds);
			await click(bounds, 8);
		} else {
			await click(graph.actionBar.items[1].bounds);
			const inspector = (ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
			check(inspector.visible && !ide.editor.quickInput.visible, 'crossfoe: Details opens full source content');
			await click(inspector.actionBar.items[0].bounds, 8);
		}
		check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model && !hasSelection(), `${route}: Source focuses code without a held selection`);
		for (let index = 0; index < 140; index += 1) await frame();
		check(model.version === cleanVersion && !model.dirty && navigationEdits === 0 && model.buffer.getText() === original,
			`${route}: navigation emits no content change and creates no dirty working copy`);
	}
	await press('ControlRight', 'ShiftRight');
	await press('ControlRight', 'ShiftRight');
	for (let index = 0; index < 140; index += 1) await frame();
	check(ide.editor.isActive && activeCodeEditor.model === model && !model.dirty && navigationEdits === 0,
		'crossfoe: reopening the IDE with the source active is clean');
	unsubscribe();
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'source/recovery controls do not modify the paused machine');
}
