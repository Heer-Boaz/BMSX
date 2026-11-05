import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { inputFocus } from '../../ide/input/focus';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { afterTest } from '../helpers/test_cleanup';

async function fixture(t: TestContext, mode: '2d' | '3d' = '2d') {
	const f = await createLiveStudioFixture(t), { editor } = f;
	const input = editor.actorLab.resolveInput();
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	part.activeGroup.openEditor(input); editor.update(0);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	editor.commands.execute(mode === '2d' ? 'sceneViewport.view2d' : 'sceneViewport.view3d', pane.commandTarget);
	editor.commands.execute('actorLab.playback', pane.commandTarget);
	await f.until(() => input.worldView.canvas.items.length > 0);
	editor.commands.execute('actorLab.playback', pane.commandTarget); await f.frame();
	const choices = readActorChoices(f.sources, f.ide.guest, 0);
	const first = choices.find(actor => actor.label === 'studio_test.first')!;
	const second = choices.find(actor => actor.label === 'studio_test.second')!;
	assert.ok(first && second);
	editor.actorLab.inspectActor(input, 0, first.hashId); editor.update(0);
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers));
		editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); editor.update(0);
	};
	return { ...f, input, part, pane, first, second, key };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Input coordinates come from the displayed visual, never from a guest pose or a screen-coordinate oracle. */
function visualPoint(f: Fixture, hashId = f.second.hashId) {
	const view = f.input.worldView, quad = view.canvas.items.find(item => item.source.entry.hashId === hashId)!;
	assert.ok(quad);
	const { affine } = quad, localX = quad.offsetX + quad.width / 2, localY = quad.offsetY + quad.height / 2;
	const wx = affine.ox + affine.xx * localX + affine.yx * localY;
	const wy = (affine.oy + affine.xy * localX + affine.yy * localY) * (view.mode === '3d' ? -1 : 1);
	const x = (view.bounds.left + view.bounds.right) / 2 + view.camera.projectX(wx, wy, 0);
	const y = (view.bounds.top + view.bounds.bottom) / 2 + view.camera.projectY(wx, wy, 0);
	assert.equal(view.pick(x, y)?.hashId, hashId);
	return { x, y };
}
function openAtVisual(f: Fixture): void {
	const { x, y } = visualPoint(f);
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true },
		{ type: 'button', button: 'secondary', down: false }]);
}
function accept(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled);
	f.key('Home'); for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown'); f.key('Enter');
}

for (const mode of ['2d', '3d'] as const) test(`live ${mode} viewport right click selects its rendered actor and opens actor actions on release`, async t => {
	const f = await fixture(t, mode), { editor, input } = f, { x, y } = visualPoint(f);
	const camera = input.worldView.camera.capture();
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]);
	assert.equal(input.actorHashId, f.first.hashId); assert.equal(editor.contextMenu.visible, false);
	const origin = inputFocus.admittedTarget;
	f.native.apply([{ type: 'button', button: 'secondary', down: false }]);
	assert.equal(input.actorHashId, f.second.hashId); assert.equal(editor.contextMenu.visible, true);
	assert.equal(editor.actorLab.selected(input)?.kind, 'actor');
	assert.deepEqual(editor.contextMenu.model.rows.filter(row => row.command !== undefined).map(row => row.command), [
		'sceneViewport.frameSelection', 'actorLab.details', 'actorLab.outline', 'actorLab.find', 'actorLab.editScene', 'actorLab.actions', 'actorLab.call', 'actorLab.emit',
	], 'a rendered actor owns the same operations as its World row, not camera navigation or component actions');
	assert.deepEqual(input.worldView.camera.capture(), camera);
	assert.equal(f.execution.paused, true, 'inspection does not alter transport intent');
	accept(f, 'actorLab.details');
	assert.equal(f.pane.inspector.visible, true); assert.equal(input.details!.subject!.actorHashId, f.second.hashId);
	editor.commands.execute('window.hide', f.pane.inspector.focusTarget); editor.update(0);
	openAtVisual(f); f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin);
});

test('viewport keyboard context addresses the selected actor rather than its inspected component', async t => {
	const f = await fixture(t), { editor, input } = f;
	editor.actorLab.openOutline(input); editor.update(0);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'component');
	assert.ok(input.outline.selectionIndex >= 0); input.rememberSelection();
	assert.equal(editor.actorLab.selected(input)?.kind, 'component');
	const { x, y } = visualPoint(f);
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'aux', down: true }, { type: 'button', button: 'aux', down: false }]);
	for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const) {
		f.key(code, modifiers);
		assert.equal(editor.contextMenu.visible, true); assert.equal(input.actorHashId, f.first.hashId);
		assert.equal(editor.actorLab.inspected(input)?.kind, 'component', 'opening the actor menu preserves inspected membership');
		assert.ok(editor.contextMenu.model.rows.some(row => row.command === 'actorLab.call' && row.enabled));
		assert.equal(editor.contextMenu.model.rows.some(row => row.command === 'actorLab.stateGraph' || row.command === 'actorLab.follow'), false);
		f.key('Escape');
	}
});

for (const mode of ['2d', '3d'] as const) test(`live ${mode} viewport drag and empty-space menu retain camera ownership`, async t => {
	const f = await fixture(t, mode), { input, editor } = f, { x, y } = visualPoint(f);
	const camera = input.worldView.camera.capture();
	const inspection = t.mock.method(editor.actorLab, 'inspectActor');
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true },
		{ type: 'pointer', x: x + 20, y: y + 10 }, { type: 'button', button: 'secondary', down: false }]);
	assert.notDeepEqual(input.worldView.camera.capture(), camera); assert.equal(input.actorHashId, f.first.hashId);
	assert.equal(editor.contextMenu.visible, false); assert.equal(inspection.mock.callCount(), 0);
	const empty = { x: input.previewBounds.right - 4, y: input.previewBounds.bottom - 4 };
	assert.ok(input.worldView.pick(empty.x, empty.y) === undefined);
	f.native.apply([{ type: 'pointer', ...empty }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(editor.contextMenu.visible, true); assert.equal(inspection.mock.callCount(), 0);
	assert.ok(editor.contextMenu.model.rows.some(row => row.command === 'sceneViewport.pan' && row.enabled));
	assert.equal(editor.contextMenu.model.rows.some(row => row.command === 'actorLab.call' || row.command === 'actorLab.editScene'), false);
});

test('live viewport actor menu survives ordinary frame progress but retires on selection and history changes', async t => {
	const f = await fixture(t);
	f.editor.commands.execute('actorLab.playback', f.pane.commandTarget); await f.frame();
	openAtVisual(f); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.input.actorHashId, f.second.hashId);
	for (let i = 0; i < 3; i++) await f.frame();
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(f.execution.paused, false);
	f.editor.actorLab.inspectActor(f.input, 0, f.first.hashId);
	assert.equal(f.editor.contextMenu.visible, false);
	openAtVisual(f); assert.equal(f.editor.contextMenu.visible, true);
	f.ide.guest.invalidate('history-restored');
	assert.equal(f.editor.contextMenu.visible, false);
});

for (const origin of ['viewport', 'outliner'] as const) test(`disposing the selected live actor publishes selection loss and retires its ${origin} menu`, async t => {
	const f = await fixture(t);
	f.editor.commands.execute('actorLab.playback', f.pane.commandTarget); await f.frame();
	if (origin === 'viewport') openAtVisual(f);
	else {
		const tree = f.input.worldOutliner.tree, index = tree.rows.findIndex(row => row.element.hashId === f.second.hashId);
		assert.ok(index >= 0);
		const x = tree.layout.contentLeft + (tree.rows[index].depth + 2) * tree.layout.indentWidth;
		const y = tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight;
		f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	}
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(f.input.actorHashId, f.second.hashId);
	let changes = 0;
	afterTest(t, f.input.onDidChangeSelection(() => { changes++; }));
	const removal = f.ide.luaEvaluation.evaluate('studio_test_actor.scene.members.second:mark_for_disposal()', 'cart');
	await f.until(() => removal.result !== undefined);
	assert.equal(removal.result!.status, 'completed', removal.result!.values.join('\n'));
	await f.until(() => !f.input.actorPresent);
	assert.equal(f.input.actorHashId, 0); assert.ok(f.input.selectionPath === undefined);
	assert.equal(changes, 1, 'membership removal publishes the same selection transition as explicit deselection');
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.execution.paused, false);
});

for (const origin of ['viewport', 'outliner'] as const) for (const replacement of ['selection', 'pane'] as const)
test(`${origin} actor menu cannot outlive reentrant ${replacement} replacement`, async t => {
	const f = await fixture(t); let replaced = false;
	const release = f.input.onDidChangeSelection(() => {
		release(); replaced = true;
		if (replacement === 'selection') f.editor.actorLab.inspectActor(f.input, 0, f.first.hashId);
		else f.part.activeGroup.openEditor(new HomeInput(null));
	});
	afterTest(t, release);
	if (origin === 'viewport') openAtVisual(f);
	else {
		const tree = f.input.worldOutliner.tree, index = tree.rows.findIndex(row => row.element.hashId === f.second.hashId);
		const x = tree.layout.contentLeft + (tree.rows[index].depth + 2) * tree.layout.indentWidth;
		const y = tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight;
		f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	}
	assert.equal(replaced, true); assert.equal(f.editor.contextMenu.visible, false);
	if (replacement === 'selection') assert.equal(f.input.actorHashId, f.first.hashId);
});
