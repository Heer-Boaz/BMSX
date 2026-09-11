import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { inputFocus } from '../../../ide/input/focus';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { check, type StudioFixture } from './studio_fixture';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { testStudioQuickPickHighlights } from './studio_quick_pick_highlights';

export async function testStudioCommandPalette(test: StudioFixture): Promise<void> {
	const { ide, harness, cycles, press, click, until, clipboard, tasks, frame, execution, runPaletteCommand } = test;
	const picker = ide.editor.quickInput;
	const position = cycles();
	console.info('STUDIO: Command Palette uses invoking control context and ordinary command execution');
	harness.openLuaSource('title_screen.lua');
	await testStudioQuickPickHighlights(test);
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	await press('ControlLeft', 'End');
	await press('KeyQ');
	check(model.buffer.getText() !== original, 'palette: real source edit precedes command selection');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('KeyH'); await press('KeyR');
	check(picker.model.list.rows.some(row => row.item.label === 'Run: Hot Resume'),
		'palette: command word initials resolve Hot Resume without literal hr in its label');
	await press('Escape');
	check(model.buffer.getText() !== original && cycles() === position,
		'palette: searching commands never executes one or changes the invoking source');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	for (const label of ['Behavior Lens: Open', 'Behavior Lens: Open ActionEffect', 'Behavior Lens: Open State Machine (FSM)',
		'Behavior Lens: Open Behavior Tree (BT)', 'Scene Editor: Open', 'Scenario Lab: Open', 'Preferences: Toggle Theme',
		'Search: Find', 'Edit: Rename Symbol', 'View: Problems Panel']) {
		check(picker.model.items.some(row => row.label === label), `palette: ${label} is categorized by task, not menu location`);
	}
	check(!picker.model.items.some(row => /^View: (Behavior|Scenario|Scene)/.test(row.label)),
		'palette: opening a tool belongs with its own actions rather than the View catch-all');
	check(picker.model.items.some(row => row.label === 'Edit: Undo'),
		'palette: editor Undo is admitted in the source context despite empty query history');
	await press('KeyU');
	await press('KeyN');
	await press('ControlLeft', 'KeyZ');
	check(picker.field.text === 'u' && model.buffer.getText() !== original, 'palette: query Undo never reaches source history');
	await press('Escape');
	await runPaletteCommand('Edit: Undo');
	check(model.buffer.getText() === original, 'palette: selected Undo restores focus before executing the actual source command');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	clipboard.text = 'Run: Resume';
	await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows[0].item.label === 'Run: Resume', 'palette: exact Resume ranks before Hot Resume while the queue is available');
	let releaseTask!: () => void;
	const gate = new Promise<void>(resolve => { releaseTask = resolve; });
	const task = tasks.schedule(() => gate, error => { throw error; });
	await frame();
	await press('Enter');
	check(execution.userPaused && !picker.visible && editorFeedbackState.message.text.includes('no longer available'),
		'palette: a real asynchronous admission change cannot execute an unavailable command');
	releaseTask();
	await task;
	await until(() => tasks.ready, 'palette: occupied queue settles without altering pause');
	await runPaletteCommand('Scenario Lab: Open');
	const scenario = getActiveTab();
	check(scenario.kind === 'scenario_lab', 'palette: Scenario Lab is an ordinary registered command');
	const scenarioFocus = inputFocus.target;
	await press('ControlLeft', 'Comma');
	await press('KeyQ');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(!picker.model.items.some(row => row.label === 'Edit: Undo' || row.label === 'Go: Go to Symbol'),
		'palette: replacing file search does not inherit its query history or the last code pane');
	clipboard.text = 'not_a_command';
	await press('ControlLeft', 'KeyV');
	await press('Enter');
	check(picker.visible && picker.model.list.selectionIndex === -1, 'palette: empty results have no synthetic command');
	await press('Escape');
	check(inputFocus.target === scenarioFocus, 'palette: cancellation restores the actual non-code control');
	await runPaletteCommand('Scene Editor: Open');
	check(picker.visible && picker.title === 'SCENE EDITOR', 'palette: command-to-picker handoff begins a new source-choice session');
	clipboard.text = 'scenes/root.lua';
	await press('ControlLeft', 'KeyV');
	await press('Enter');
	const scene = getActiveTab();
	if (scene.kind !== 'scene_editor') throw new Error('palette: chosen Scene Editor is missing');
	const source = scene.workingCopy.buffer.getText();
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('palette: actual scene pane missing');
	await click(scene.properties[0].bounds);
	await press('Digit5');
	check(pane.controls[0].pending, 'palette: a real property draft exists');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(!pane.controls[0].pending && scene.properties[0].value === 5,
		'palette: property blur accepts before command enumeration');
	check(!picker.model.items.some(row => row.label === 'Edit: Undo')
		&& picker.model.items.some(row => row.label === 'File: Save'),
		'palette: empty property history does not fall through to document Undo; accepted source enables Save');
	clipboard.text = 'File: Save';
	await press('ControlLeft', 'KeyV');
	await press('Enter');
	await until(() => !scene.workingCopy.dirty, 'palette: actual Save persists accepted scene source');
	check(scene.workingCopy.lastSavedSource === scene.workingCopy.buffer.getText()
		&& inputFocus.target === pane.controls[0].field.focusTarget, 'palette: Save neither targets stale code nor loses the originating property');
	await press('Enter');
	await runPaletteCommand('Edit: Undo');
	check(scene.workingCopy.buffer.getText() === source, 'palette: explicitly focusing the scene admits its document history');
	await runPaletteCommand('File: Save');
	await until(() => !scene.workingCopy.dirty, 'palette: restore the canonical fixture through ordinary Save');
	await runPaletteCommand('Scene Editor: Open Source');
	check(getActiveTab().kind === 'code_editor' && harness.getActiveEditorDocument().model === scene.workingCopy,
		'palette: category-disambiguated Source executes the registered scene action');
	check(cycles() === position, 'palette: source, view and history commands do not advance the paused machine');
	await openSceneEditor(test);
}

export async function presentCommandPalette(test: StudioFixture): Promise<void> {
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = TOP_BAR_MENUS.view.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === 'commandPalette')!;
	await test.click(item.bounds);
	check(test.ide.editor.quickInput.visible, 'palette: the actual View menu also exposes Command Palette');
	await test.frame();
}
