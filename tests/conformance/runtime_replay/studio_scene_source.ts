import { getOrCreateSemanticProject } from '../../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../../ide/input/focus';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { GX_REGISTER_SOURCE_PATH } from '../../../toolchain/ts/rompack/generated_modules';
import { buildSceneSourceDocument } from '../../../ide/workbench/contrib/scene_editor/source';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { check, type StudioFixture } from './studio_fixture';

export async function openSceneEditor(test: StudioFixture): Promise<SceneEditorInput> {
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = TOP_BAR_MENUS.view.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === 'sceneEditor')!;
	check(!item.disabled, 'scene: the actual View menu admits the Lua document');
	await test.click(item.bounds);
	const input = getActiveTab();
	if (input.kind !== 'scene_editor') throw new Error('scene: View command must open the Scene Editor');
	return input;
}

export async function selectMember(test: StudioFixture, input: SceneEditorInput, index: number): Promise<void> {
	const layout = input.members.layout;
	const top = layout.contentTop + (index - input.members.scroll) * layout.rowHeight;
	await test.click({ left: layout.contentLeft, right: layout.contentRight, top, bottom: top + layout.rowHeight });
	check(input.members.selectionIndex === index, 'scene: actual member row is selected by its visible pointer target');
}

/** Real menu, row, property, focus, history and source-command input on the shipped cart. */
export async function testSceneSourceEdits(test: StudioFixture): Promise<void> {
	const { ide, harness, runtime, tasks, until, press, click, frame, runMenuCommand, cycles, title, guest } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const project = getOrCreateSemanticProject(model.resource.domain);
	project.synchronizeRuntimeSources(ide.sources);
	const titlePositionField = () => {
		const document = buildSceneSourceDocument(model.resource,
			project.updateDocument(model.resource.path, model.buffer.getText()));
		check(document.scenes.length === 1 && document.scenes[0].objects.length === 4, 'scene: actual Nemesis root assembly');
		const member = document.scenes[0].objects[2];
		if (member.kind !== 'object' || member.position === null) throw new Error('scene: actual title position field missing');
		return member.position.x;
	};
	const actor = title();
	const actorX = guest.readStringMember(actor, 'x');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	const original = model.buffer.getText();
	const field = titlePositionField();
	const start = model.buffer.offsetAt(field.value.range.start.line - 1, field.value.range.start.column - 1);
	const end = model.buffer.offsetAt(field.value.range.end.line - 1, field.value.range.end.column);
	// Simulate hand-authored grouping/trivia, which the old unary-range edit destroyed.
	const authoredValue = '-( --[[source-owned anchor]]\n\t\t\t\t\t0)';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: authoredValue }]);
	const authored = model.buffer.getText();
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'scene: save the hand-authored source fixture before testing a clean-document property edit');
	const scene = await openSceneEditor(test);
	check(scene.workingCopy === model && scene.members.rows.length === 4, 'scene: visual view shares the actual resource-owned source model');
	await selectMember(test, scene, 2);
	const retainedRow = scene.members.rows[2];
	const retainedField = scene.properties[0].field;
	for (let index = 0; index < 8; index += 1) await frame();
	check(scene.members.rows[2] === retainedRow && scene.properties[0].field === retainedField,
		'scene: stable visible frames retain the same row and source projection objects');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('scene: the actual Scene Editor pane must own these controls');
	const [x, y, z] = pane.controls;
	const expected = original.slice(0, start) + '( --[[source-owned anchor]]\n\t\t\t\t\t17)' + original.slice(end);
	await click(scene.properties[0].bounds);
	check(x.field.focusTarget.hasFocus, 'scene: the physical property hit target receives input focus');
	await press('Digit1');
	await press('Digit7');
	check(x.field.text === '17' && model.buffer.getText() === authored, 'scene: local draft does not rewrite Lua before acceptance');
	await press('ControlLeft', 'KeyZ');
	check(x.field.text === '1' && model.buffer.getText() === authored, 'scene: physical field Undo leaves the document alone');
	await press('ControlLeft', 'KeyY');
	check(x.field.text === '17', 'scene: field Redo restores the draft');
	check(!model.dirty && x.pending && ide.editor.commands.isEnabled('save'), 'scene: an unsubmitted property enables Save on a clean document');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'scene: Save accepts focused value before capturing the workspace source');
	check(model.buffer.getText() === expected && model.lastSavedSource === expected, 'scene: only numeric/sign tokens changed, not member expressions or trivia');
	check(x.field.focusTarget.hasFocus && !x.field.canUndo, 'scene: accepted field resets its local history without losing focus');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: empty draft history never falls through to document Undo');
	await press('Enter');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored && x.field.text === '0', 'scene: one physical document Undo restores all tokens and rebinds the view');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === expected && x.field.text === '17', 'scene: physical Redo restores the source-preserving property edit');

	await press('Tab');
	check(x.field.focusTarget.hasFocus, 'scene: the view focus order enters the first editable property');
	await press('Minus');
	await press('Enter');
	check(x.field.text === '-' && x.field.focusTarget.hasFocus && x.error.length > 0, 'scene: invalid Enter retains the draft with an error');
	await press('ControlLeft', 'KeyS');
	await press('ControlLeft', 'ShiftLeft', 'KeyS');
	check(x.field.text === '-' && x.field.focusTarget.hasFocus && actionPromptState.prompt === null
		&& model.buffer.getText() === expected && ide.sources.currentBlua32Media === media,
		'scene: invalid input prevents Save/Hot Resume before source capture or prompt admission');
	await press('Escape');
	check(x.field.text === '17' && !x.pending, 'scene: Escape explicitly cancels the draft');
	await click(scene.properties[0].bounds);
	await press('Minus');
	await selectMember(test, scene, 0);
	check(model.buffer.getText() === expected && editorFeedbackState.message.text === 'Invalid integer edit cancelled; source unchanged.',
		'scene: leaving an invalid value explicitly reports rejection without changing either member');
	await selectMember(test, scene, 2);

	await click(scene.properties[1].bounds);
	await press('Digit2');
	await press('Tab');
	check(z.field.focusTarget.hasFocus && scene.properties[1].value === 2, 'scene: Tab accepts the old field before focusing its neighbour');
	await press('ShiftLeft', 'Tab');
	check(y.field.focusTarget.hasFocus && y.field.text === '2', 'scene: reverse traversal follows the same retained focus order');
	await press('Escape');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected && y.field.text === '0', 'scene: field blur creates one source undo operation');

	await click(scene.properties[0].bounds);
	await press('Digit9');
	await click(scene.actionBar.items[0].bounds);
	check(getActiveTab().kind === 'code_editor' && harness.getActiveEditorDocument().model === model,
		'scene: the real Source action navigates to the same model');
	check(model.buffer.getText() === expected.replace('\t17)', '\t09)'), 'scene: source navigation accepts the departing control before resource detach');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: code Undo sees the same property history');
	await press('Tab');
	check(model.buffer.getText() !== expected, 'scene: code text retains its ordinary Tab editing, not property traversal');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: code Tab edit is undoable in the same document');
	check(await openSceneEditor(test) === scene && x.field.text === '17', 'scene: returning to the retained visual view rebinds undone source');
	await click(scene.actionBar.items[0].bounds);
	const storyName = 'story.instance_id';
	model.pushEditOperations([{ offset: expected.indexOf(storyName), deleteLength: storyName.length, text: 'intro.instance_id' }]);
	await openSceneEditor(test);
	await selectMember(test, scene, 1);
	check(scene.members.rows[0].label === scene.members.rows[1].label
		&& scene.members.rows[0].entry.field !== scene.members.rows[1].entry.field, 'scene: repeated source expressions retain their distinct syntax fields');
	await click(scene.properties[0].bounds);
	await press('Digit5');
	await press('Enter');
	check(scene.members.selectionIndex === 1 && scene.properties[0].value === 5, 'scene: accepting a repeated-name member never redirects selection to its namesake');
	await press('ControlLeft', 'KeyZ');
	await click(scene.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: source Undo removes only the duplicate-name fixture');
	await openSceneEditor(test);
	await selectMember(test, scene, 2);

	// Arrange an unsupported expression in the same canonical source, never a runtime fallback.
	await click(scene.actionBar.items[0].bounds);
	const numericStart = expected.indexOf('17)', start);
	model.pushEditOperations([
		{ offset: expected.indexOf('objects = {') + 'objects = {'.length, deleteLength: 0, text: ' [1] = ' },
		{ offset: numericStart, deleteLength: 2, text: 'origin + 1' },
	]);
	const dynamic = model.buffer.getText();
	await openSceneEditor(test);
	check(scene.partial && scene.members.rows.length === 3, 'scene: explicit-key composition is labelled partial, not invented as ordered runtime members');
	check(x.field.readOnly && scene.properties[0].sourceText.includes('origin + 1'), 'scene: dynamic Lua is shown as source, not evaluated or overwritten');
	await click(scene.properties[0].bounds);
	await press('Digit7');
	check(model.buffer.getText() === dynamic, 'scene: a source-only expression has no numeric input route');
	await press('Tab');
	check(y.field.focusTarget.hasFocus, 'scene: focus traversal skips the unsupported property');
	await press('Escape');
	await click(scene.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: source Undo restores the numeric form without executing Lua');

	harness.openLuaSource(GX_REGISTER_SOURCE_PATH);
	const generated = harness.getActiveEditorDocument().model;
	const generatedSource = generated.buffer.getText();
	const readonlyScene = await openSceneEditor(test);
	check(readonlyScene.workingCopy === generated && generated.readOnly && readonlyScene.members.rows.length === 0,
		'scene: readonly non-scene source does not invent a scene or an edit route');
	check(!ide.editor.commands.isEnabled('sceneEditor.removeMember'), 'scene: readonly source does not admit Remove');
	await press('Tab');
	await press('Digit7');
	await press('ControlLeft', 'KeyZ');
	check(generated.buffer.getText() === generatedSource && model.buffer.getText() === expected,
		'scene: readonly view commands never target the previous editable input');
	harness.openLuaSource('scenes/root.lua');
	await openSceneEditor(test);
	check(!scene.partial, 'scene: undoing the source edit restores complete projection');
	await click(scene.properties[0].bounds);
	await press('Digit2');
	await press('Digit2');
	await click(editorChromeState.tabButtonBounds.get(readonlyScene.id)!);
	check(getActiveTab() === readonlyScene && model.buffer.getText() === expected.replace('\t17)', '\t22)')
		&& generated.buffer.getText() === generatedSource, 'scene: switching inputs of the same retained pane accepts against the departing resource');
	await click(editorChromeState.tabButtonBounds.get(scene.id)!);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected && x.field.text === '17', 'scene: document history remains attached to the correct resource after pane reuse');
	await click(scene.properties[0].bounds);
	await press('Digit1');
	await press('Digit8');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive && !x.pending && model.buffer.getText() === expected.replace('\t17)', '\t18)'),
		'scene: hiding the IDE accepts the departing property, not an implicit guest edit');
	await press('ControlRight', 'ShiftRight');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: reopening the IDE retains the accepted source history');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'scene: saving a definition does not install it');
	check(cycles() === position && title() === actor && ide.sources.currentBlua32Media === media,
		'scene: source edits, focus, view switches, undo/redo and save do not mutate the paused machine');

	await click(scene.properties[0].bounds);
	await press('Digit1');
	await press('Digit8');
	await press('Enter');
	await click(scene.properties[0].bounds);
	await press('Digit1');
	await press('Digit7');
	check(x.pending && scene.properties[0].value === 18, 'scene: Hot Resume starts with an actual unsubmitted value');
	await press('ControlLeft', 'ShiftLeft', 'KeyS');
	check(actionPromptState.prompt !== null && actionPromptState.prompt.workingCopies.includes(model)
		&& model.buffer.getText() === expected && !x.pending, 'scene: Hot Resume accepts the field before selecting dirty working copies');
	await press('Enter');
	await until(() => tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive,
		'scene: edited root definition passes actual Hot Resume and init');
	await until(() => actionPromptState.prompt === null, 'scene: accepted source action completes its real prompt');
	check(model.lastSavedSource === expected, 'scene: Save and Resume persisted the accepted field');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected,
		'scene: actual installed code owns the new source revision');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'scene: definition source is now installed');
	check(title() === actor && guest.readStringMember(actor, 'x') === actorX,
		'scene: reregistration does not silently move or replace the living actor');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource('title_screen.lua');
}

/** The following explicit product reboot must consume the edited composition normally. */
export async function testSceneSourceAfterReboot(test: StudioFixture): Promise<void> {
	const { ide, harness, runtime, execution, until, press, runMenuCommand, cycles, title, guest, frame } = test;
	check(execution.userPaused && ide.editor.isActive, 'scene: explicit reboot retained host pause and source editor');
	await runMenuCommand('pause');
	await until(() => cycles() > runtime.timing.cpuHz * 22, 'scene: normal cold boot instantiates the edited root');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	check(guest.readStringMember(title(), 'x') === 17, 'scene: the real newly instantiated title actor consumes the edited x value');
	harness.openLuaSource('scenes/root.lua');
	check(getTextFileRuntimeSourceStatus(ide.sources, harness.getActiveEditorDocument().model) === 'applied',
		'scene: the reopened source is exactly the composition used by the new world');
	await frame();
}

/** Fault-gated screenshot of the actual tiny-font property view at the native IDE resolution. */
export async function presentSceneEditor(test: StudioFixture): Promise<void> {
	const input = await openSceneEditor(test);
	await selectMember(test, input, 2);
	await test.click(input.properties[0].bounds);
	check(inputFocus.target?.edit !== undefined && input.properties[0].value === 17, 'scene: the final view shows the actual applied member position');
	await test.frame();
}
