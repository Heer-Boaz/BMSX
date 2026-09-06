import type { EditorTextModel } from '../../../ide/editor/model/text_model';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { closeTab, getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { check, type StudioFixture } from './studio_fixture';

/** W04 uses actual text commands and the existing read-only source lens, not a second authored format. */
export async function testSourceViewsBeforeApply(
	test: StudioFixture,
	model: EditorTextModel,
	originalRule: string,
	newRule: string,
): Promise<string> {
	const { ide, harness, press, frame, until, cycles, title } = test;
	const source = model.buffer.getText();
	const position = cycles();
	const actor = title();
	const media = ide.sources.currentBlua32Media;
	const status = () => getTextFileRuntimeSourceStatus(ide.sources, model);
	check(status() === 'applied', 'W04: newly opened source matches the installed code');
	model.pushEditOperations([{ offset: source.indexOf(originalRule), deleteLength: originalRule.length, text: newRule }]);
	const edited = source.replace(originalRule, newRule);
	check(model.dirty && status() === 'pending', 'W04: typing immediately differs from both saved and installed source');
	const sourceTab = getActiveTab();
	harness.executeCommand('behaviorLens');
	await frame();
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('W04: source lens command must open a visual view');
	check(lens.view.sourceVersion === model.version, 'W04: source lens projects the edited document version');
	check(lens.view.document.definitions.length > 0, 'W04: actual title FSM registration is visible');
	harness.openLuaSource(model.resource.path);
	check(harness.getActiveEditorDocument().model === model, 'W04: returning to text attaches the same document');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source && !model.dirty && status() === 'applied', 'W04: undo before apply returns to the saved and installed source');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === edited && status() === 'pending', 'W04: redo restores one exact source edit');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'W04: actual workspace save completes');
	check(model.lastSavedSource === edited && status() === 'pending', 'W04: saved source is not automatically installed code');
	harness.executeCommand('behaviorLens');
	await frame();
	check(getActiveTab() === lens && lens.view.sourceVersion === model.version, 'W04: the retained source lens refreshes after undo and redo');
	closeTab(ide.editor.editorPanes, ide.sources, sourceTab.id);
	await frame();
	check(getActiveTab() === lens, 'W04: closing the code tab does not close its source view');
	harness.openLuaSource(model.resource.path);
	check(harness.getActiveEditorDocument().model === model, 'W04: reopening a closed tab retains document content and history');
	const note = '\n-- W04: this unsaved source edit is included in Hot Resume.\n';
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: note }]);
	check(model.dirty && status() === 'pending', 'W04: saved, edited and installed sources are three different states');
	check(ide.sources.currentBlua32Media === media && cycles() === position && title() === actor,
		'W04: view switches, save and source undo leave the paused machine untouched');
	return edited + note;
}

export async function testSourceUndoAfterApply(test: StudioFixture, model: EditorTextModel, installed: string, original: string): Promise<void> {
	const { ide, harness, press, until, cycles, title } = test;
	harness.openLuaSource(model.resource.path);
	const media = ide.sources.currentBlua32Media;
	const position = cycles();
	const actor = title();
	const status = () => getTextFileRuntimeSourceStatus(ide.sources, model);
	check(status() === 'applied' && model.buffer.getText() === installed, 'W04: only actual code installation makes the captured source current');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && status() === 'pending', 'W04: source undo after Hot Resume does not undo that installation');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'W04: save undone source');
	check(status() === 'pending', 'W04: saving old source leaves newer code installed');
	await press('ControlLeft', 'KeyY');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === installed && model.dirty && status() === 'applied',
		'W04: redo can match installed code while still differing from the saved file');
	check(ide.sources.currentBlua32Media === media && cycles() === position && title() === actor,
		'W04: post-apply source history cannot rewind or replace the actual actor');
}

/** Hold the real exclusive task queue; the editor must not acknowledge later text as installed. */
export async function testCapturedSourceApply(test: StudioFixture): Promise<void> {
	const { ide, harness, tasks, frame, until, press, runMenuCommand, runtime, cycles, title } = test;
	harness.openLuaSource('title_screen.lua');
	const model = harness.getActiveEditorDocument().model;
	const actor = title();
	const position = cycles();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- W04 captured revision\n' }]);
	const captured = model.buffer.getText();
	let releaseTask!: () => void;
	const gate = new Promise<void>(resolve => { releaseTask = resolve; });
	const blockedTask = tasks.schedule(() => gate, error => { throw error; });
	const pendingApply = harness.performHotResume();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '-- W04 later typing\n' }]);
	for (let index = 0; index < 4; index += 1) await frame();
	check(cycles() === position && getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'W04: waiting source build does not acknowledge or execute edited code');
	releaseTask();
	await blockedTask;
	await pendingApply;
	await until(() => tasks.ready && !ide.debugger.plans.mutationActive && !runtime.completionCallPending(), 'W04: captured source apply completes');
	check(title() === actor, 'W04: an asynchronous source install retains the real actor');
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('title_screen') === captured, 'W04: only the captured source is compiled, not later typing');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'W04: later typing stays visibly unapplied after installation');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource(model.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === captured && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'W04: undo returns exactly to the captured installed revision');
}

export async function testAemSourceApplication(test: StudioFixture): Promise<void> {
	const { ide, harness, tasks, until, press, title } = test;
	const resource = ide.sources.cartridgeSlots[0]!.dataResources.find(item => item.source.type === 'aem')!;
	await ide.editor.navigation.openResource(resource);
	const model = harness.getActiveEditorDocument().model;
	const status = () => getTextFileRuntimeSourceStatus(ide.sources, model);
	check(model.mode === 'aem' && status() === 'untracked', 'W04: opening real AEM source does not invent an installed-source acknowledgement');
	const actor = title();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n# W04 actual asset source application\n' }]);
	const applied = model.buffer.getText();
	await press('ControlLeft', 'KeyS');
	await until(() => tasks.ready && !model.dirty && status() === 'applied', 'W04: real AEM save installs cooked asset and records its authored source');
	check(title() === actor, 'W04: AEM application does not replace the game world');
	await press('ControlLeft', 'KeyZ');
	check(status() === 'pending', 'W04: source undo does not undo the installed AEM asset');
	await press('ControlLeft', 'KeyY');
	check(status() === 'applied' && !model.dirty, 'W04: AEM redo matches both saved and installed source');
	const media = ide.sources.currentBlua32Media;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\nevents: [\n' }]);
	await press('ControlLeft', 'KeyS');
	await until(() => status() === 'failed', 'W04: invalid authored AEM reports apply failure');
	check(tasks.ready, 'W04: an AEM source-build rejection cannot latch a machine execution failure');
	check(!model.dirty && ide.sources.currentBlua32Media === media, 'W04: failed AEM build saves text without replacing media');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === applied && status() === 'failed', 'W04: undo does not hide a failed apply operation');
	await press('ControlLeft', 'KeyS');
	await until(() => tasks.ready && status() === 'applied', 'W04: corrected AEM applies through the same save owner');
	harness.openLuaSource('title_screen.lua');
}

/** Explicit reboot has the same accepted-source ordering; it is deliberately not a state-retention test. */
export async function testCapturedSourceReboot(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, until } = test;
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- W04 reboot request\n' }]);
	const captured = model.buffer.getText();
	const rebooting = harness.reboot();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '-- W04 edit after reboot admission\n' }]);
	await rebooting;
	check(ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('title_screen') === captured,
		'W04: reboot applies its captured document after older saved workspace sources');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'W04: reboot cannot acknowledge later typing');
	ide.editor.activate();
	await ide.editor.navigation.openResource(model.resource);
	await frame();
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === captured && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied',
		'W04: source undo reaches the actual reboot revision');
	await until(() => !editorFeedbackState.message.visible, 'W04: installed-source status is visible after transient feedback');
}
