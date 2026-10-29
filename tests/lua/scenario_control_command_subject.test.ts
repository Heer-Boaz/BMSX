import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InputFocusScope, InputFocusTarget, inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveEditorCommandGroup } from '../../ide/commands/context';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { ScenarioLabEditorPane } from '../../ide/workbench/contrib/scenario_lab/editor_pane';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

const CONTROL_COMMANDS = [
	'scenarioLab.continue', 'scenarioLab.stepInto', 'scenarioLab.stepOver',
	'scenarioLab.stepOut', 'scenarioLab.pause', 'scenarioLab.breakpoints',
] as const;

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model,
		{ document, sourceVersion: model.version, scene: document.scenes[0] }, f.first.commandTarget), true);
	const main = f.editor.mainWorkspace.primary;
	assert.ok(main instanceof ScenePrimaryClient);
	const controller = f.editor.scenarioLab, input = controller.resolveInput();
	f.firstGroup.openEditor(input); f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(pane instanceof ScenarioLabEditorPane);
	f.editor.editorParts.activate(f.firstPart);
	return { ...f, main, controller, input, pane };
}

test('Main cannot recover Scenario controls from its background document destination', async t => {
	const f = await fixture(t);
	t.mock.method(f.controller, 'isCommandEnabled', (_command, input) => input === f.input);
	const execute = t.mock.method(f.controller, 'executeCommand', () => {});
	assert.equal(resolveEditorCommandGroup(f.editor, f.main.commandTarget), undefined);
	assert.equal(f.editor.editorParts.activeGroup.model.activeTab, f.input);
	for (const command of CONTROL_COMMANDS) {
		assert.equal(f.main.commandTarget.resolveCommand(command), undefined);
		assert.equal(f.editor.commands.isEnabled(command, f.main.commandTarget), false);
		f.editor.commands.execute(command, f.main.commandTarget);
	}
	assert.equal(execute.mock.callCount(), 0);
	f.main.focus();
	f.editor.commands.execute('commandPalette', f.main.commandTarget);
	const picks = f.editor.quickInput.model.list.rows.map(row => (row.item as CommandQuickPickItem).command);
	for (const command of CONTROL_COMMANDS) assert.equal(picks.includes(command), false);
	f.editor.quickInput.hide();
});

test('a control without an exported Scenario capability cannot borrow its semantic pane handler', async t => {
	const f = await fixture(t), context = f.pane.commandTarget;
	const child = inputFocus.createTarget(context, new InputFocusScope(context.scope.surfaceScope, context.scope));
	child.commandContext = context;
	t.mock.method(f.controller, 'isCommandEnabled', (_command, input) => input === f.input);
	const execute = t.mock.method(f.controller, 'executeCommand', () => {});
	for (const command of CONTROL_COMMANDS) {
		assert.ok(context.getCommand(command));
		assert.equal(child.resolveCommand(command), undefined);
		assert.equal(f.editor.commands.isEnabled(command, child), false);
		f.editor.commands.execute(command, child);
	}
	assert.equal(execute.mock.callCount(), 0);
});

test('actual Scenario controls and title chrome keep their native subject', async t => {
	const f = await fixture(t), target = f.pane.commandTarget, toolbar = target.previous;
	assert.ok(toolbar instanceof InputFocusTarget);
	t.mock.method(f.controller, 'isCommandEnabled', (_command, input) => input === f.input);
	const execute = t.mock.method(f.controller, 'executeCommand', () => {});
	for (const origin of [target, toolbar]) for (const command of CONTROL_COMMANDS) {
		assert.ok(origin.getCommand(command));
		assert.equal(f.editor.commands.isEnabled(command, origin), true);
		f.editor.commands.execute(command, origin);
		const call = execute.mock.calls.at(-1)!;
		assert.equal(call.arguments[0], command);
		assert.equal(call.arguments[1], f.input);
		assert.equal(call.arguments[2], f.firstGroup);
		assert.equal(call.arguments[3], f.firstPart.quickInput);
	}
	assert.equal(execute.mock.callCount(), CONTROL_COMMANDS.length * 2);
});

test('Scenario Palette addresses its captured native control independently of the later active document', async t => {
	const f = await fixture(t), target = f.pane.commandTarget;
	t.mock.method(f.controller, 'isCommandEnabled', (_command, input) => input === f.input);
	const execute = t.mock.method(f.controller, 'executeCommand', () => {});
	for (const command of CONTROL_COMMANDS) {
		target.focus();
		f.editor.commands.execute('commandPalette', target);
		const picker = f.editor.quickInput;
		const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === command);
		assert.ok(index >= 0);
		f.editor.editorParts.activate(f.secondPart);
		picker.model.list.selectionIndex = index;
		await picker.accept();
		const call = execute.mock.calls.at(-1)!;
		assert.equal(call.arguments[0], command);
		assert.equal(call.arguments[1], f.input);
		assert.equal(call.arguments[2], f.firstGroup);
	}
	assert.equal(execute.mock.callCount(), CONTROL_COMMANDS.length);
});

test('disabled local Scenario commands shadow an enabled pane in application and Palette routing', async t => {
	const f = await fixture(t), context = f.pane.commandTarget;
	const child = inputFocus.createTarget(context, new InputFocusScope(context.scope.surfaceScope, context.scope));
	child.commandContext = context;
	t.mock.method(f.controller, 'isCommandEnabled', (_command, input) => input === f.input);
	const execute = t.mock.method(f.controller, 'executeCommand', () => {});
	for (const command of CONTROL_COMMANDS) child.registerCommand(command, {
		isEnabled: () => false, run: () => assert.fail('a disabled local capability cannot execute'),
	});
	for (const command of CONTROL_COMMANDS) {
		assert.equal(f.editor.commands.isEnabled(command, child), false);
		f.editor.commands.execute(command, child);
	}
	f.editor.commands.execute('commandPalette', child);
	const picks = f.editor.quickInput.model.list.rows.map(row => (row.item as CommandQuickPickItem).command);
	for (const command of CONTROL_COMMANDS) assert.equal(picks.includes(command), false);
	f.editor.quickInput.hide();
	assert.equal(execute.mock.callCount(), 0);
});

test('global Scenario Reveal and Stop retain their run owner without a Scenario document subject', async t => {
	const f = await fixture(t), results = f.controller.runs.results;
	const old = results.beginRun('scenario-root:previous', []); results.cancelRun(old);
	const live = results.beginRun('scenario-root:active', []);
	t.mock.getter(f.controller.runs, 'active', () => results.liveRun !== null);
	const reveal = t.mock.method(f.controller, 'revealRun', () => {});
	const cancel = t.mock.method(f.controller.runs, 'cancel', run => { results.cancelRun(run); });
	f.firstGroup.activate(f.firstInput.id); f.update();
	assert.equal(f.editor.commands.isEnabled('scenarioLab.revealRun', f.main.commandTarget), true);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.cancel', f.main.commandTarget), true);
	f.editor.commands.execute('scenarioLab.revealRun', f.main.commandTarget);
	assert.equal(reveal.mock.calls[0].arguments[0], live);
	f.editor.commands.execute('scenarioLab.cancel', f.main.commandTarget);
	assert.equal(cancel.mock.calls[0].arguments[0], live);
	assert.equal(f.editor.commands.isEnabled('scenarioLab.cancel', f.main.commandTarget), false);
	f.editor.commands.execute('scenarioLab.revealRun', f.main.commandTarget);
	assert.equal(reveal.mock.calls[1].arguments[0], live, 'the latest retained run remains globally revealable after stopping');
});
