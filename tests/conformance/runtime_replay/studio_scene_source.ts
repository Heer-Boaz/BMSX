import { getOrCreateSemanticProject } from '../../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { createLuaTableFieldIntegerEdits } from '../../../ide/language/lua/source_edits';
import { buildSceneSourceDocument } from '../../../ide/workbench/contrib/scene_editor/source';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { check, type StudioFixture } from './studio_fixture';

/** Language-owner proof on the actual cart source; this is not a visual-editor interaction test. */
export async function testSceneSourceEdits(test: StudioFixture): Promise<void> {
	const { ide, harness, runtime, tasks, until, press, runMenuCommand, cycles, title, guest } = test;
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
	const edits = createLuaTableFieldIntegerEdits(model.buffer, titlePositionField(), 17);
	if (edits === null) throw new Error('scene: a direct numeric field must be editable');
	model.pushEditOperations(edits);
	const expected = original.slice(0, start) + '( --[[source-owned anchor]]\n\t\t\t\t\t17)' + original.slice(end);
	check(model.buffer.getText() === expected, 'scene: only numeric/sign tokens changed, not member expressions or trivia');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'scene: one physical Undo restores the complete token batch');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === expected, 'scene: physical Redo restores the source-preserving field edit');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'scene: actual workspace save completes');
	check(model.lastSavedSource === expected && getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending',
		'scene: saving a definition does not install it');
	check(cycles() === position && title() === actor && ide.sources.currentBlua32Media === media,
		'scene: source edit, undo/redo and save do not mutate the paused machine');
	await harness.performHotResume();
	await until(() => tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive,
		'scene: edited root definition passes actual Hot Resume and init');
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
