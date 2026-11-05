import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import { createLiveStudioFixture } from '../helpers/live_studio';

async function fixture(t: TestContext, actor = 'runner') {
	const f = await createLiveStudioFixture(t), { editor } = f;
	editor.commands.execute('gameView'); editor.update(0);
	const input = editor.actorLab.resolveInput(), controller = input.controller;
	const group = editor.editorParts.findGroup(input)!, pane = group.panes.activePane!;
	assert.ok(pane instanceof ActorLabEditorPane);
	const row = input.worldOutliner.tree.rows.find(row => row.element.label === actor)!;
	assert.ok(row);
	controller.inspectActor(input, input.domain, row.element.hashId);
	const click = (x: number, y: number) => f.native.apply([{ type: 'pointer', x, y },
		{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	const key = (code: string, down = true, repeat = false) => {
		const event = new KeyInputEvent(code, KeyModifier.none, repeat, down);
		editor.dispatchKey(event); return event.consumed;
	};
	return { ...f, input, controller, group, pane, click, key };
}

for (const kind of ['timeline', 'machine', 'tree'] as const) test(`${kind} inspection and runtime history survive presentation, focus and tab changes`, async t => {
	const f = await fixture(t, kind === 'tree' ? 'bystander' : 'runner');
	const { editor, input, controller, group, pane } = f;
	const member = input.runtime.roots[0].children.flatMap(node => [node, ...node.children]).find(node => node.kind === kind)!;
	assert.ok(member); const identity = member.hashId, actor = input.actorHashId;
	controller.projection.reveal(member); editor.update(0);
	const path = input.selectionPath, context = pane.inputScope.runtime;
	assert.equal(group.timeline.visible, true, 'general transport does not require a reveal command');
	if (kind === 'timeline') assert.equal(input.timeline.visible, true, 'actor and machine timelines coexist');
	controller.openWorld(input); editor.update(0);
	for (const command of ['gameView', 'actorLab', 'sceneViewport.view2d', 'sceneViewport.view3d', 'actorLab.gameView'] as const) {
		editor.commands.execute(command, pane.commandTarget); editor.update(0);
		assert.ok(editor.actorLab.resolveInput() === input && group.model.activeTab === input);
		assert.ok(input.selectionPath === path && pane.inputScope.runtime === context);
		assert.equal(controller.inspected(input)?.hashId, identity);
		assert.equal(group.timeline.visible, true);
	}
	controller.inspectActor(input, input.domain, actor); editor.update(0);
	assert.ok(input.selectionPath === path, 'selecting the same actor is idempotent');
	const tree = input.worldOutliner.tree.layout;
	f.click(tree.contentLeft + 4, tree.contentBottom - 4); editor.update(0);
	assert.equal(input.actorHashId, actor, 'blank outliner focus is not an actor-selection command');
	assert.equal(controller.inspected(input)?.hashId, identity);
	group.openEditor(new TerminalInput()); editor.update(0);
	editor.commands.execute('gameView'); editor.update(0);
	assert.ok(group.model.activeTab === input);
	assert.equal(controller.inspected(input)?.hashId, identity);
	assert.equal(group.timeline.visible, true);
	controller.openOutline(input); editor.update(0);
	assert.equal(controller.selected(input)?.hashId, identity);
});

for (const kind of ['timeline', 'machine', 'tree'] as const) test(`${kind} inspection survives disclosure without becoming its visible ancestor`, async t => {
	const f = await fixture(t, kind === 'tree' ? 'bystander' : 'runner');
	const { input, controller, editor, group } = f;
	const member = input.runtime.roots[0].children.flatMap(node => [node, ...node.children]).find(node => node.kind === kind)!;
	controller.projection.reveal(member); editor.update(0);
	const path = input.selectionPath, tree = input.outline, ancestor = tree.rows[tree.selectionIndex].parent!;
	let selectionChanges = 0;
	input.onDidChangeSelection(() => { selectionChanges++; });
	const disclose = () => {
		const index = tree.rows.indexOf(ancestor);
		assert.ok(index >= 0);
		f.click(tree.rowLeft + ancestor.depth * tree.layout.indentWidth + tree.layout.twistieWidth / 2,
			tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight);
		editor.update(0);
	};
	disclose();
	assert.equal(ancestor.collapsed, true);
	assert.ok(input.selectionPath === path, 'disclosure changes the visible rows, not the inspected identity');
	assert.equal(controller.inspected(input)?.hashId, member.hashId);
	assert.equal(selectionChanges, 0);
	if (kind === 'timeline') assert.equal(input.timeline.visible, true);
	controller.refreshDetails(input);
	assert.deepEqual(input.details!.subject!.path, path);
	group.openEditor(new TerminalInput()); editor.update(0);
	editor.commands.execute('gameView'); editor.update(0);
	assert.equal(ancestor.collapsed, true);
	assert.equal(controller.inspected(input)?.hashId, member.hashId);
	disclose();
	assert.equal(ancestor.collapsed, false);
	assert.ok(tree.rows.some(row => row.element.node === input.selectedOutlineNode));
	assert.equal(selectionChanges, 0, 'revealing the retained selection is not another selection command');
	f.key('ArrowLeft'); f.key('ArrowLeft', false); editor.update(0);
	assert.equal(ancestor.collapsed, true, 'keyboard navigation retains a visible ancestor as its cursor');
	f.key('ArrowRight'); f.key('ArrowRight', false); editor.update(0);
	assert.equal(ancestor.collapsed, false);
	assert.ok(input.selectionPath === path && controller.inspected(input) === member);
	assert.equal(selectionChanges, 0, 'keyboard disclosure also preserves inspection');
	f.key('ArrowDown'); f.key('ArrowDown', false); editor.update(0);
	assert.ok(controller.inspected(input) === tree.rows[tree.selectionIndex].element.node, 'explicit navigation selects the new cursor');
});

test('FSM graph selection and camera survive world navigation and navigation-history restoration', async t => {
	const { input, controller, editor, pane } = await fixture(t);
	const machine = input.runtime.roots[0].children.flatMap(node => node.children).find(node => node.kind === 'machine')!;
	controller.projection.reveal(machine); editor.update(0);
	editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0);
	const graph = input.stateGraph!;
	graph.selectTarget(graph.viewport.model.nodes[1].target);
	graph.viewport.pan(20, 10);
	const selected = graph.selectionBookmark, camera = graph.viewport.captureViewState();
	controller.openWorld(input); editor.update(0);
	const bookmark = controller.captureSelection(input);
	controller.openOutline(input); editor.update(0);
	assert.equal(input.presentation, 'graph'); assert.ok(graph.selectionBookmark === selected);
	assert.deepEqual(graph.viewport.captureViewState(), camera);
	controller.restoreSelection(input, bookmark, input.layout.font!.renderFont()); editor.update(0);
	bookmark.restoreViewport(input);
	assert.equal(input.presentation, 'world');
	controller.openOutline(input); editor.update(0);
	assert.equal(input.presentation, 'graph');
	assert.deepEqual(input.stateGraph!.selectionBookmark, selected);
	assert.deepEqual(input.stateGraph!.viewport.captureViewState(), camera);
});

test('Space toggles the inspected runtime without repeating or stealing captured game keys', async t => {
	const f = await fixture(t), { input, pane, key, group } = f;
	pane.focus(); assert.equal(f.execution.paused, true);
	assert.equal(key('Space'), true); key('Space', false);
	assert.equal(f.execution.paused, false); const start = f.runtime.machine.scheduler.currentNowCycles();
	await f.frame(); await f.frame(); assert.ok(f.runtime.machine.scheduler.currentNowCycles() > start);
	key('Space', true, true); assert.equal(f.execution.paused, false, 'autorepeat is not another transport press');
	key('Space'); key('Space', false); assert.equal(f.execution.paused, true);
	group.timeline.focus(); inputFocus.moveFocus(false);
	key('Space'); key('Space', false); assert.equal(f.execution.paused, false);
	const bounds = input.previewBounds;
	f.click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
	assert.ok(inputFocus.target?.guestInput);
	assert.equal(key('Space'), false); key('Space', false);
	assert.equal(f.execution.paused, false, 'guest Space stays owned by the game');
});

for (const mode of ['game', '2d', '3d', 'outliner'] as const) test(`${mode} actor menus preserve deep inspection and address the clicked actor rather than its inspected member`, async t => {
	const f = await fixture(t), { input, controller, editor, pane } = f;
	editor.commands.execute('runtime.resume', pane.commandTarget);
	await f.until(() => [...controller.renderFrames.displayed.quads].some(quad => quad.hashId === input.actorHashId));
	editor.commands.execute('runtime.pause', pane.commandTarget); editor.update(0);
	const actor = input.runtime.roots[0], timeline = actor.children.flatMap(node => node.children).find(node => node.kind === 'timeline')!;
	controller.projection.reveal(timeline); editor.update(0);
	const path = input.selectionPath;
	if (mode === 'outliner') controller.openWorld(input);
	else editor.commands.execute(mode === 'game' ? 'actorLab.gameView' : mode === '2d' ? 'sceneViewport.view2d' : 'sceneViewport.view3d', pane.commandTarget);
	editor.update(0);
	let x: number, y: number;
	if (mode === 'outliner') {
		const tree = input.worldOutliner.tree, index = tree.rows.findIndex(row => row.element.hashId === actor.hashId);
		x = tree.layout.contentLeft + (tree.rows[index].depth + 2) * tree.layout.indentWidth;
		y = tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight;
	} else if (mode === 'game') {
		const frame = controller.viewportPicker.frame, b = input.previewBounds;
		const quad = [...frame.quads].find(quad => quad.hashId === input.actorHashId)!;
		assert.ok(quad);
		x = b.left + (quad.ox + frame.offsetX + (quad.ax + quad.bx) / 2) * (b.right - b.left) / frame.width;
		y = b.top + (quad.oy + frame.offsetY + (quad.ay + quad.by) / 2) * (b.bottom - b.top) / frame.height;
	} else {
		const visual = input.worldView.canvas.items.find(item => item.source.entry.hashId === input.actorHashId)!;
		assert.ok(visual);
		const view = input.worldView, a = visual.affine, lx = visual.offsetX + visual.width / 2, ly = visual.offsetY + visual.height / 2;
		const wx = a.ox + a.xx * lx + a.yx * ly, wy = (a.oy + a.xy * lx + a.yy * ly) * (mode === '3d' ? -1 : 1);
		x = (view.bounds.left + view.bounds.right) / 2 + view.camera.projectX(wx, wy, 0);
		y = (view.bounds.top + view.bounds.bottom) / 2 + view.camera.projectY(wx, wy, 0);
		assert.equal(view.pick(x, y)?.hashId, input.actorHashId);
	}
	f.native.apply([{ type: 'pointer', x, y },
		{ type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(editor.contextMenu.visible, true);
	assert.ok(input.selectionPath === path && controller.inspected(input) === timeline);
	assert.equal(input.timeline.visible, true); assert.equal(f.group.timeline.visible, true);
	const call = t.mock.method(pane.actorActions, 'callMethod');
	const index = editor.contextMenu.model.rows.findIndex(row => row.command === 'actorLab.call');
	assert.ok(index >= 0 && editor.contextMenu.model.rows[index].enabled);
	f.key('Home'); f.key('Home', false);
	for (let step = 0; step < editor.contextMenu.model.rows.length && editor.contextMenu.model.selectedIndex !== index; step++) {
		f.key('ArrowDown'); f.key('ArrowDown', false);
	}
	assert.equal(editor.contextMenu.model.selectedIndex, index);
	f.key('Enter'); f.key('Enter', false);
	assert.equal(call.mock.callCount(), 1);
	assert.ok(call.mock.calls[0].arguments[1] === actor, 'the menu subject is the actor, not the retained timeline');
	assert.ok(input.selectionPath === path);
	assert.ok(inputFocus.admittedTarget?.textInput, 'Call Method opens the actual scoped argument picker');
	f.key('Escape'); f.key('Escape', false);
	const origin = inputFocus.admittedTarget;
	f.key('ContextMenu'); f.key('ContextMenu', false);
	assert.equal(editor.contextMenu.visible, true, 'keyboard context retains the same native actor surface');
	f.key('Escape'); f.key('Escape', false);
	assert.ok(inputFocus.admittedTarget === origin);
	assert.equal(controller.inspected(input)?.hashId, timeline.hashId);
});

test('Space is not a transport shortcut in a text draft or an active camera gesture', async t => {
	const f = await fixture(t), { editor, pane, input, key } = f;
	editor.quickInput.input('Arguments', '', '', async text => text, () => {});
	assert.ok(inputFocus.target?.textInput);
	key('Space'); key('Space', false);
	assert.equal(f.execution.paused, true);
	editor.quickInput.hide();
	editor.commands.execute('sceneViewport.view2d', pane.commandTarget); editor.update(0);
	const b = input.previewBounds;
	f.native.apply([{ type: 'pointer', x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 },
		{ type: 'button', button: 'aux', down: true }]);
	assert.equal(pointerCapture.active, true);
	key('Space'); key('Space', false);
	assert.equal(f.execution.paused, true);
	f.native.apply([{ type: 'button', button: 'aux', down: false }]);
});

for (const kind of ['actor', 'timeline'] as const) test(`${kind} outline menu owns its actual row, not the other inspection level`, async t => {
	const { input, controller, editor, pane, key, native } = await fixture(t);
	const actor = input.runtime.roots[0], node = kind === 'actor' ? actor : actor.children.flatMap(node => node.children).find(node => node.kind === kind)!;
	controller.projection.reveal(node); editor.update(0);
	const tree = input.outline, index = tree.selectionIndex;
	const x = tree.layout.contentLeft + (tree.rows[index].depth + 2) * tree.layout.indentWidth;
	const y = tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight;
	native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(editor.contextMenu.visible, true);
	for (const command of ['actorLab.emit', 'actorLab.editScene', 'actorLab.find'] as const)
		assert.equal(editor.contextMenu.model.rows.some(row => row.command === command), kind === 'actor', 'actor operations belong only to the actor row');
	const call = t.mock.method(pane.actorActions, 'callMethod'), callIndex = editor.contextMenu.model.rows.findIndex(row => row.command === 'actorLab.call');
	assert.ok(callIndex >= 0 && editor.contextMenu.model.rows[callIndex].enabled);
	key('Home'); key('Home', false);
	for (let step = 0; step < editor.contextMenu.model.rows.length && editor.contextMenu.model.selectedIndex !== callIndex; step++) {
		key('ArrowDown'); key('ArrowDown', false);
	}
	key('Enter'); key('Enter', false);
	assert.equal(call.mock.callCount(), 1);
	assert.ok(call.mock.calls[0].arguments[1] === node);
	key('Escape'); key('Escape', false);
});
