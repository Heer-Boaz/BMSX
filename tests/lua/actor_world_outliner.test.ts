import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { inputFocus } from '../../ide/input/focus';
import { ActorWorldOutliner } from '../../ide/workbench/contrib/actor_lab/world_outliner';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { findRuntimeActor } from '../../ide/workbench/contrib/actor_lab/runtime';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { runCompletionClosure } from './cpu_test_harness';

test('World revisions reconcile admitted membership and parentage without rebuilding for motion', () => {
	const { images } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({def_id='outliner.actor', class=object_2d})
parent = world:spawn('outliner.actor', {id='parent'})
child = world:spawn('outliner.actor', {id='child'})
other = world:spawn('outliner.actor', {id='other'})
world:reparent(child, parent, false)
subject_world = world
function move() child:set_position(24, 12) end
function begin_spawn()
 world:_open_mutation_barrier()
 pending = world:spawn('outliner.actor', {id='pending'})
end
function commit_spawn() world:_commit_mutation_barrier() end
function reparent() world:reparent(child, other, false) end
function remove_parent() parent:mark_for_disposal() end
function rename() other.id = 'a renamed actor' end
function clear_world() world:clear() end
return true`, { optLevel: 3, modules: WORLD_CPU_MODULES });
	const { runtime, cpu } = eventHistoryRuntime(images);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const guest = new SuspendedGuestSession(runtime), outliner = new ActorWorldOutliner(), tree = outliner.tree;
	const world = guest.global('subject_world') as Table;
	const parent = (guest.global('parent') as Table).hashId, child = (guest.global('child') as Table).hashId,
		other = (guest.global('other') as Table).hashId;
	const call = (name: string) => { runCompletionClosure(cpu, guest.global(name) as Closure, []); };
	const row = (id: number) => tree.rows.find(item => item.element.hashId === id)!;
	assert.equal(outliner.update(guest, world, child), true);
	tree.updateLayout(0, 0, 200, 200, 20, 12);
	outliner.reveal(child);
	assert.equal(tree.rows.length, 3);
	assert.equal(row(child).parent!.element.hashId, parent);
	assert.equal(row(parent).element.containsSelection, true);
	const revision = outliner.revision, childRow = row(child), otherRow = row(other);
	call('move');
	assert.equal(outliner.update(guest, world, child), false);
	assert.equal(outliner.revision, revision);
	assert.ok(row(child) === childRow && row(other) === otherRow, 'motion retains row bindings');

	setWorkbenchTreeCollapsed(tree, tree.rows.indexOf(row(parent)), true);
	assert.equal(outliner.update(guest, world, child), false);
	assert.equal(row(parent).element.containsSelection, true, 'a collapsed ancestor still represents the selected descendant');
	assert.ok(!tree.rows.includes(childRow));
	outliner.reveal(child);
	assert.ok(tree.rows[tree.selectionIndex] === childRow);
	call('begin_spawn');
	assert.equal(outliner.update(guest, world, child), false, 'queued construction is not admitted membership');
	call('commit_spawn');
	assert.equal(outliner.update(guest, world, child), true);
	assert.equal(tree.rows.length, 4);
	assert.ok(tree.rows[tree.selectionIndex] === childRow, 'membership changes preserve identity-based focus');
	call('reparent');
	assert.equal(outliner.update(guest, world, child), true);
	assert.equal(row(child).parent!.element.hashId, other);
	assert.equal(row(other).element.containsSelection, true);
	assert.equal(row(parent).element.containsSelection, false);
	assert.equal(tree.rows[tree.selectionIndex].element.hashId, child);
	call('remove_parent');
	assert.equal(outliner.update(guest, world, child), true);
	assert.equal(tree.rows.length, 3);
	assert.ok(outliner.readActor(guest, world, parent) === undefined);
	for (const item of tree.rows) assert.equal(outliner.readActor(guest, world, item.element.hashId)!.hashId, item.element.hashId,
		'dense-array removal rebinds swapped slots rather than following an old index');
	call('rename');
	assert.equal(outliner.update(guest, world, child), true);
	assert.equal(row(other).element.label, 'a renamed actor', 'visible labels bind the actual runtime id');
	assert.equal(tree.rows[tree.selectionIndex].element.hashId, child);
	call('clear_world');
	assert.equal(outliner.update(guest, world, child), true);
	assert.equal(tree.rows.length, 0);
	assert.ok(outliner.readActor(guest, world, child) === undefined);
	assert.equal(outliner.update(guest, world, child), false);
});

test('live Outliner selection, disclosure, Details and viewport navigation do not pause the game', async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	// Test setup invokes ordinary cartlib through the BIOS evaluator, not a Studio
	// fixture-recognition path or a host write into the guest object graph.
	const setup = ide.luaEvaluation.evaluate(`local parent = studio_test_actor
parent.world:reparent(parent.scene.members.second, parent, true)`, 'cart');
	await f.until(() => setup.result !== undefined);
	assert.equal(setup.result!.status, 'completed', setup.result!.values.join('\n'));
	const controller = editor.actorLab, view = controller.resolveInput();
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	part.activeGroup.openEditor(view); editor.update(0);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	const choices = readActorChoices(sources, ide.guest, 0);
	const first = choices.find(actor => actor.label === 'studio_test.first')!, second = choices.find(actor => actor.label === 'studio_test.second')!,
		bystander = choices.find(actor => actor.label === 'bystander')!;
	assert.ok(first && second && bystander);
	assert.equal(view.presentation, 'world');
	assert.deepEqual(view.worldOutliner.tree.rows.map(row => row.element.hashId).sort((a, b) => a - b),
		choices.map(actor => actor.hashId).sort((a, b) => a - b), 'the Outliner contains all admitted actors, not selected-actor components');
	const tree = view.worldOutliner.tree;
	const click = (x: number, y: number, button: 'primary' | 'secondary' = 'primary') => {
		f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button, down: true }, { type: 'button', button, down: false }]);
		editor.update(0);
	};
	const clickActor = (hashId: number, disclosure = false, button: 'primary' | 'secondary' = 'primary') => {
		const index = tree.rows.findIndex(row => row.element.hashId === hashId);
		assert.ok(index >= 0);
		const row = tree.rows[index], layout = tree.layout;
		click(layout.contentLeft + (row.depth + (disclosure ? 0.5 : 2)) * layout.indentWidth,
			layout.contentTop + (index - (tree.scroll | 0) + 0.5) * layout.rowHeight, button);
	};
	const key = (code: string) => {
		editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none));
		editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false)); editor.update(0);
	};
	clickActor(second.hashId);
	assert.equal(view.actorHashId, second.hashId);
	editor.commands.execute('actorLab.details', pane.commandTarget); editor.update(0);
	assert.equal(pane.inspector.visible, true);
	assert.equal(view.details!.subject!.actorHashId, second.hashId);
	editor.commands.execute('actorLab.playback', pane.commandTarget);
	await f.frame(); assert.equal(f.execution.paused, false);
	const updates = () => ide.guest.readStringMember(findRuntimeActor(sources, ide.guest, 0, bystander.hashId)!, 'updates') as number;
	const before = updates(), revision = view.worldOutliner.revision;
	clickActor(first.hashId, true);
	assert.equal(view.actorHashId, second.hashId, 'disclosure changes row focus without changing live selection');
	assert.equal(view.details!.subject!.actorHashId, second.hashId);
	assert.equal(tree.rows.find(row => row.element.hashId === first.hashId)!.element.containsSelection, true);
	for (let i = 0; i < 4; i++) await f.frame();
	assert.ok(updates() > before); assert.equal(f.execution.paused, false);
	assert.equal(view.worldOutliner.revision, revision, 'ordinary simulation does not rebuild World topology');
	pane.focus(); editor.commands.execute('contextMenu', pane.commandTarget);
	assert.equal(editor.contextMenu.visible, true);
	assert.equal(view.actorHashId, first.hashId, 'keyboard context from pane focus addresses the focused World row, not the hidden component tree');
	key('Escape');
	clickActor(bystander.hashId);
	assert.equal(view.actorHashId, bystander.hashId); assert.equal(view.details!.subject!.actorHashId, bystander.hashId);
	await f.frame(); assert.equal(f.execution.paused, false);
	const rowFocus = inputFocus.target;
	key('Tab');
	assert.ok(inputFocus.target !== null && inputFocus.target !== rowFocus, 'pointer-focused Outliner participates in the pane tab order');
	clickActor(bystander.hashId);
	key('End');
	assert.equal(view.actorHashId, tree.rows[tree.rows.length - 1].element.hashId, 'keyboard focus selects the corresponding live actor');
	assert.equal(view.details!.subject!.actorHashId, view.actorHashId);

	editor.commands.execute('sceneViewport.view2d', pane.commandTarget); editor.update(0);
	assert.equal(view.worldView.mode, '2d');
	clickActor(bystander.hashId);
	const camera = view.worldView.camera;
	camera.pan(80, 40); const reading = camera.capture();
	key('KeyF');
	assert.notDeepEqual(camera.capture(), reading, 'F frames the selected actor from the Outliner without a camera-mode button');
	await f.frame(); assert.equal(f.execution.paused, false);
	editor.commands.execute('window.hide', pane.inspector.focusTarget); editor.update(0);
	assert.equal(pane.inspector.visible, false);
	editor.commands.execute('sceneViewport.frameAll', pane.commandTarget); editor.update(0);
	const visual = view.worldView.canvas.items.find(item => item.source.entry.hashId === second.hashId)!;
	assert.ok(visual);
	click(visual.x + (visual.xx + visual.yx) / 2, visual.y + (visual.xy + visual.yy) / 2);
	assert.equal(view.actorHashId, second.hashId, 'viewport picking selects the same runtime identity');
	assert.equal(tree.rows[tree.selectionIndex].element.hashId, second.hashId, 'viewport selection reveals its collapsed Outliner ancestors');
	assert.equal(view.details!.subject!.actorHashId, second.hashId, 'closed Details still follows the live selection');
	editor.commands.execute('actorLab.details', pane.commandTarget); editor.update(0);
	assert.equal(pane.inspector.visible, true);
	assert.equal(view.details!.subject!.actorHashId, second.hashId);
	clickActor(first.hashId, false, 'secondary');
	assert.equal(view.actorHashId, first.hashId, 'row context targets the actor under the pointer');
	assert.equal(editor.contextMenu.visible, true);
	assert.equal(editor.contextMenu.model.rows.find(row => row.command === 'actorLab.details')!.enabled, true);
	for (let i = 0; i < 2; i++) await f.frame();
	assert.equal(editor.contextMenu.visible, true, 'ordinary frame progress does not revoke a scalar-identity row menu');
	assert.equal(f.execution.paused, false);
	key('Escape');
	click(tree.layout.contentLeft + 2 * tree.layout.indentWidth, tree.layout.contentBottom - tree.layout.rowHeight / 2);
	assert.equal(view.actorHashId, 0, 'empty Outliner space clears selection');
	assert.ok(view.details!.subject === undefined);
	await f.frame(); assert.equal(f.execution.paused, false);
	editor.commands.execute('actorLab.playback', pane.commandTarget);
	await f.frame(); assert.equal(f.execution.paused, true, 'only explicit Pause stops simulation');
});
