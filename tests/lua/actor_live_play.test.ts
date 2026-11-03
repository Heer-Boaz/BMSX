import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { findRuntimeActor } from '../../ide/workbench/contrib/actor_lab/runtime';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';

import { createLiveStudioFixture } from '../helpers/live_studio';

/** Ordinary testcart boot, real cartlib and the same physical host phases as Studio.
 * No integration setup, standalone timeline sampler or substituted World. */
async function fixture(t: TestContext) {
	const { ide, editor, sources, runtime, execution, backend, tasks, native, frame, until } = await createLiveStudioFixture(t);
	const controller = editor.actorLab;
	const source = resolveLuaTextFileModel(editorTextModelService, sources.catalog,
		sources.catalog.luaResources.find(resource => resource.path === 'scenes/live.lua')!);
	const sourceVersion = source.version, sourceText = source.buffer.getText();
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	const actors = readActorChoices(sources, ide.guest, 0), view = controller.resolveInput();
	const runner = actors.find(actor => actor.label === 'runner')!, bystander = actors.find(actor => actor.label === 'bystander')!;
	assert.ok(runner); assert.ok(bystander);
	controller.inspectActor(view, 0, runner.hashId);
	part.activeGroup.openEditor(view); editor.update(0);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	const select = (name: string) => {
		controller.refresh(view);
		const machine = view.runtime.roots[0].children.find(node => node.children.some(child => child.kind === 'machine'))!.children[0];
		controller.projection.reveal(machine.children.find(node => node.name === name)!); editor.update(0);
	};
	const value = (actor: typeof runner, field: string) => ide.guest.readStringMember(findRuntimeActor(sources, ide.guest, 0, actor.hashId)!, field);
	const run = () => {
		assert.equal(editor.commands.isEnabled('actorLab.run', pane.commandTarget), true);
		editor.commands.execute('actorLab.run', pane.commandTarget);
		return ide.actorExecution.active!;
	};
	return { ide, editor, controller, view, pane, part, frame, until, select, run, value, runner, bystander, execution, backend, runtime, tasks,
		native, source, sourceVersion, sourceText };
}

test('Run on a live FSM executes its entry and then the whole game; Pause and Step keep the same machine', async t => {
	const f = await fixture(t);
	f.select('moving');
	const bounds = f.view.actionBar.items.find(item => item.command === 'actorLab.run')!.bounds;
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	const operation = f.ide.actorExecution.active!;
	assert.ok(operation); assert.equal(f.part.quickInput.visible, false);
	await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed');
	assert.equal(f.view.interaction.running, true); assert.equal(f.execution.paused, false);
	assert.equal(f.value(f.runner, 'entries'), 1);
	const first = f.value(f.runner, 'updates') as number, other = f.value(f.bystander, 'updates') as number;
	const presentation = f.ide.guest.readStringMember(f.value(f.runner, 'visual'), 'presentation_oy');
	const before = new Uint8Array(f.backend.borrowPresentedPixels());
	for (let i = 0; i < 12; i++) await f.frame();
	assert.ok((f.value(f.runner, 'updates') as number) > first);
	assert.ok((f.value(f.bystander, 'updates') as number) > other, 'unselected BT actor is simulated too');
	assert.notEqual(f.ide.guest.readStringMember(f.value(f.runner, 'visual'), 'presentation_oy'), presentation,
		'the controller-started presentation timeline advances alongside gameplay');
	assert.notDeepEqual(f.backend.borrowPresentedPixels(), before, 'normal World rendering changes completed pixels');
	f.editor.commands.execute('actorLab.playback', f.pane.commandTarget);
	const stopped = f.value(f.runner, 'updates'), cycles = f.runtime.machine.scheduler.currentNowCycles();
	for (let i = 0; i < 3; i++) await f.frame();
	assert.equal(f.value(f.runner, 'updates'), stopped); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), cycles);
	f.editor.commands.execute('stepFrame', f.pane.commandTarget);
	const step = f.ide.frameNavigation.active!; assert.ok(step);
	await f.until(() => step.result !== undefined);
	assert.equal(step.result!.status, 'completed'); assert.equal(f.execution.paused, true);
	assert.ok(f.runtime.machine.scheduler.currentNowCycles() > cycles);
	assert.equal(f.source.version, f.sourceVersion, 'runtime actions never rewrite authored source');
	assert.equal(f.source.buffer.getText(), f.sourceText);
	const timeline = f.view.runtime.roots[0].children.flatMap(node => node.children).find(node => node.kind === 'timeline')!;
	f.controller.projection.reveal(timeline); f.editor.update(0);
	assert.equal(f.editor.commands.isEnabled('actorLab.run', f.pane.commandTarget), false,
		'registration alone does not authorize a new timeline play with invented targets or parameters');
});

test('Run in the live state graph honors cartlib transition guards and follows actual activity', async t => {
	const f = await fixture(t);
	f.select('blocked'); f.controller.openStateGraph(f.view, editorViewState.font.renderFont()); f.editor.update(0);
	const operation = f.run(); await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed');
	assert.equal(f.value(f.runner, 'entries'), 0);
	for (let i = 0; i < 3; i++) await f.frame();
	const graph = f.view.stateGraph!;
	assert.equal(graph.viewport.model.nodes.find(node => node.name === 'idle')!.active, true);
	assert.equal(graph.viewport.model.nodes.find(node => node.name === 'blocked')!.active, false);
	assert.equal(f.value(f.runner, 'updates'), 0);
	assert.equal(f.view.interaction.running, true, 'a refused transition is not a fabricated pose or a frozen game');
});

test('Run restarts the selected BT through its ordinary lifecycle without touching another actor', async t => {
	const f = await fixture(t);
	f.controller.inspectActor(f.view, 0, f.bystander.hashId);
	f.controller.projection.reveal(f.view.runtime.roots[0].children.find(node => node.kind === 'tree')!); f.editor.update(0);
	f.editor.commands.execute('actorLab.actions', f.pane.commandTarget);
	const picker = f.part.quickInput;
	picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => 'method' in row.item && row.item.method === 'stop');
	assert.ok(picker.model.list.selectionIndex >= 0); await picker.accept();
	const stop = f.ide.actorExecution.active!; await f.until(() => stop.result !== undefined);
	assert.equal(f.controller.selected(f.view)!.active, false);
	const before = f.value(f.bystander, 'updates') as number;
	const operation = f.run(); await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed');
	for (let i = 0; i < 4; i++) await f.frame();
	assert.ok((f.value(f.bystander, 'updates') as number) > before);
	assert.equal(f.value(f.runner, 'updates'), 0);
});

test('Actor Pause controls an admitted Run and Continue drains the call without silently restarting gameplay', async t => {
	const f = await fixture(t); f.select('moving'); const operation = f.run();
	await f.tasks.join();
	assert.equal(operation.status, 'running');
	assert.equal(f.editor.commands.isEnabled('pause', f.pane.commandTarget), true);
	f.editor.commands.execute('pause', f.pane.commandTarget);
	assert.equal(operation.status, 'paused');
	const cycles = f.runtime.machine.scheduler.currentNowCycles();
	await f.frame(); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), cycles);
	f.editor.commands.execute('pause', f.pane.commandTarget);
	await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed'); assert.equal(f.value(f.runner, 'entries'), 1);
	assert.equal(f.view.interaction.running, false); assert.equal(f.execution.paused, true);
});

test('a new Pause published while admitting live-follow wins over the completing Run', async t => {
	const f = await fixture(t); f.select('moving');
	const release = f.view.interaction.onDidChange(() => {
		if (f.view.interaction.running) f.controller.viewport.transport.pause();
	});
	t.after(release);
	const operation = f.run(); await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed');
	assert.equal(f.execution.userPaused, true);
});

for (const change of ['pause', 'selection', 'deactivate'] as const) test(`late Run completion cannot resume after ${change}`, async t => {
	const f = await fixture(t); f.select('moving'); const operation = f.run();
	if (change === 'pause') f.controller.viewport.transport.pause();
	else if (change === 'selection') f.select('idle');
	else f.part.activeGroup.openEditor(new GameViewInput());
	await f.until(() => operation.result !== undefined);
	assert.equal(f.view.interaction.running, false); assert.equal(f.execution.paused, true);
});
