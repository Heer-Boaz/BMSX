import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { toggleEditor } from '../../ide/workbench/overlay_modes';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { RuntimeTimelineLayout } from '../../ide/workbench/ui/runtime_timeline';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchSlider } from '../../ide/workbench/ui/slider';
import { editorViewState } from '../../ide/editor/ui/view/state';

async function fixture(t: TestContext, presentation: 'viewless' | 'workbench' = 'viewless') {
	const f = await createLiveStudioFixture(t, presentation);
	const { editor } = f;
	toggleEditor(editor, f.sources, f.ide.overlayRenderer, f.runtime);
	f.ide.transport.resumeHere(); await f.frame(); await f.frame();
	toggleEditor(editor, f.sources, f.ide.overlayRenderer, f.runtime);
	editor.commands.execute('actorLab'); editor.update(0);
	const input = editor.actorLab.resolveInput(), group = editor.editorParts.findGroup(input)!;
	const pane = group.panes.activePane!;
	assert.ok(pane instanceof ActorLabEditorPane);
	toggleEditor(editor, f.sources, f.ide.overlayRenderer, f.runtime);
	await f.frame();
	toggleEditor(editor, f.sources, f.ide.overlayRenderer, f.runtime); await f.frame();
	return { ...f, input, group, pane };
}

for (const route of ['command', 'button'] as const) test(`Continue from Here ${route} resumes the displayed Game runtime after timeline review`, async t => {
	const f = await fixture(t, 'workbench');
	f.editor.commands.execute('runtime.playback', f.pane.commandTarget);
	for (let i = 0; i < 20; i++) await f.frame();
	f.editor.commands.execute('runtime.pause', f.pane.commandTarget);
	const actor = f.input.worldOutliner.tree.rows.find(row => row.element.label === 'studio_test.first')!;
	f.input.controller.inspectActor(f.input, f.input.domain, actor.element.hashId);
	f.input.controller.projection.reveal(f.input.runtime.roots[0].children[0]); f.editor.update(0);
	const selection = f.input.selectionPath;
	const actions = createWorkbenchActionBar('runtime.title'), layout = new RuntimeTimelineLayout(), bounds = f.group.timelineBounds;
	const range = new WorkbenchSlider();
	layout.update(actions, range, editorViewState.font.renderFont(), bounds.left, bounds.top, bounds.right, 0, 0);
	f.native.apply([{ type: 'pointer', x: range.bounds.right - (range.bounds.right - range.bounds.left) / 10, y: (range.bounds.top + range.bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	await f.frame();
	f.native.apply([{ type: 'button', button: 'primary', down: false }]); await f.frame();
	await f.until(() => f.ide.frameNavigation.active === undefined);
	assert.equal(f.ide.rewind.active, true);
	assert.equal(f.input.actorPresent, true, 'the reviewed frame still contains the selected actor');
	const cycles = f.runtime.machine.scheduler.currentNowCycles();
	assert.equal(f.editor.commands.isEnabled('runtime.resume', f.pane.commandTarget), true);
	if (route === 'command') f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	else {
		const button = actions.items.find(item => item.command === 'runtime.resume')!.bounds;
		f.native.apply([{ type: 'pointer', x: (button.left + button.right) / 2, y: (button.top + button.bottom) / 2 },
			{ type: 'button', button: 'primary', down: true }]);
		await f.frame();
		f.native.apply([{ type: 'button', button: 'primary', down: false }]);
	}
	assert.equal(f.input.interaction.running, true, 'Continue publishes live intent');
	await f.frame(); await f.frame();
	assert.equal(f.input.interaction.running, true, 'ending history review retains live intent');
	assert.equal(f.execution.paused, false, 'Continue releases the displayed runtime hold');
	await f.until(() => f.runtime.machine.scheduler.currentNowCycles() > cycles);
	assert.deepEqual(f.input.selectionPath, selection, 'continuing preserves the inspected component');
});

for (const running of [false, true]) test(`Actor and component pointer selection survives presentation and blur while ${running ? 'running' : 'paused'}`, async t => {
	const f = await fixture(t, 'workbench');
	if (running) { f.editor.commands.execute('runtime.playback', f.pane.commandTarget); await f.frame(); }
	const tree = f.input.worldOutliner.tree;
	const index = tree.rows.findIndex(row => row.element.label === 'studio_test.first');
	const actor = tree.rows[index].element.hashId;
	f.native.apply([{ type: 'pointer', x: tree.rowLeft + tree.layout.indentWidth * 2,
		y: tree.layout.contentTop + (index - tree.scroll + 0.5) * tree.layout.rowHeight },
		{ type: 'button', button: 'primary', down: true }]);
	await f.frame(); f.native.apply([{ type: 'button', button: 'primary', down: false }]); await f.frame();
	assert.equal(f.input.actorHashId, actor);
	f.editor.commands.execute('actorLab.outline', inputFocus.target); await f.frame();
	const outline = f.input.outline, memberIndex = outline.rows.findIndex(row => row.element.node.kind === 'component');
	const member = outline.rows[memberIndex].element.node.hashId;
	f.native.apply([{ type: 'pointer', x: outline.rowLeft + outline.layout.indentWidth * 4,
		y: outline.layout.contentTop + (memberIndex - outline.scroll + 0.5) * outline.layout.rowHeight },
		{ type: 'button', button: 'primary', down: true }]);
	await f.frame(); f.native.apply([{ type: 'button', button: 'primary', down: false }]); await f.frame();
	assert.equal(f.input.selectedOutlineNode?.hashId, member);
	const selection = f.input.selectionPath;
	// Empty scanout takes input focus; it is not an instruction to clear inspection.
	f.native.apply([{ type: 'pointer', x: f.input.previewBounds.right - 2, y: f.input.previewBounds.bottom - 2 },
		{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	await f.frame(); await f.frame();
	assert.equal(f.input.actorHashId, actor); assert.equal(f.input.selectedOutlineNode?.hashId, member);
	assert.deepEqual(f.input.selectionPath, selection);
	assert.equal(f.execution.paused, !running, 'input focus does not change playback intent');
});

for (const presentation of ['world', 'outline'] as const) test(`Actor ${presentation} exposes overflow through the shared horizontal scrollbar without changing selection`, async t => {
	const f = await fixture(t);
	f.editor.preferences.fontVariant = 'msx'; f.display.workspace.layout(1152, 864, 1);
	const actor = f.input.worldOutliner.tree.rows.find(row => row.element.label === 'studio_test.first')!;
	f.input.controller.inspectActor(f.input, f.input.domain, actor.element.hashId);
	if (presentation === 'outline') f.editor.commands.execute('actorLab.outline', f.pane.commandTarget);
	f.input.split.requestedSize = 0; await f.frame();
	const tree = presentation === 'world' ? f.input.worldOutliner.tree : f.input.outline;
	const bar = tree.horizontalScrollbar;
	assert.equal(bar.isVisible(), true, 'long authored identities remain reachable in the compact panel');
	const selected = f.input.actorHashId, focus = inputFocus.target;
	const thumb = bar.getThumb()!, track = bar.getTrack();
	const x = (thumb.left + thumb.right) / 2, y = (track.top + track.bottom) / 2;
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await f.frame(); assert.equal(pointerCapture.active, true);
	f.native.apply([{ type: 'pointer', x: track.right, y }]); await f.frame();
	f.native.apply([{ type: 'button', button: 'primary', down: false }]); await f.frame();
	assert.ok(tree.scrollLeft > 0); assert.equal(pointerCapture.active, false);
	assert.equal(f.input.actorHashId, selected); assert.ok(inputFocus.target === focus);
	f.display.workspace.layout(2400, 1200, 1); f.input.split.requestedSize = 500; f.editor.update(0);
	assert.equal(bar.isVisible(), false); assert.equal(tree.scrollLeft, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`Actor Lab ${variant} panel divider resizes through the ordinary workspace pointer route`, async t => {
	const f = await fixture(t);
	f.editor.preferences.fontVariant = variant; f.display.workspace.layout(1152, 864, 1); await f.frame();
	f.editor.commands.execute('sceneViewport.view2d', f.pane.commandTarget); await f.frame();
	const split = f.input.layout.split!;
	assert.ok(split !== undefined && split.resizable);
	const preview = f.input.previewBounds;
	f.native.apply([{ type: 'pointer', x: preview.right - 4, y: preview.bottom - 4 },
		{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	const focus = inputFocus.target;
	for (const delta of [-20, 40]) {
		const position = split.position, horizontal = split.orientation === 'horizontal';
		const x = horizontal ? position : (split.bounds.left + split.bounds.right) / 2;
		const y = horizontal ? (split.bounds.top + split.bounds.bottom) / 2 : position;
		f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
		await f.frame();
		assert.equal(pointerCapture.active, true);
		f.native.apply([{ type: 'pointer', x: x + (horizontal ? delta : 0), y: y + (horizontal ? 0 : delta) }]);
		await f.frame();
		assert.ok(delta < 0 ? split.position < position : split.position > position,
			'the initial layout permits both shrinking and growing the Outliner');
		assert.equal(pointerCapture.active, true, 'viewport relayout retains the sibling sash gesture');
		f.native.apply([{ type: 'button', button: 'primary', down: false }]);
		await f.frame();
		assert.equal(pointerCapture.active, false);
		assert.ok(inputFocus.target === focus, 'resizing preserves viewport keyboard focus');
	}
});

test('Actor Lab runtime commands retain their subject across top-menu navigation', async t => {
	const f = await fixture(t);
	const key = (code: string) => {
		f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none));
		f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false));
		f.editor.update(0);
	};
	f.group.timeline.hide();
	f.editor.commands.execute('menubar.focus'); key('ArrowRight'); key('ArrowRight');
	assert.equal(f.editor.menubar.activeMenu, 'view');
	const rows = f.editor.contextMenu.model.rows;
	const index = rows.findIndex(row => row.command === 'runtime.toggleTimeline');
	assert.ok(index >= 0 && rows[index].enabled, 'View exposes the current runtime timeline');
	key('Home'); for (let i = 0; i < index; i++) if (rows[i].enabled) key('ArrowDown'); key('Enter');
	assert.equal(f.group.timeline.visible, true);
	f.editor.commands.execute('menubar.focus'); key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
	assert.equal(f.editor.menubar.activeMenu, 'run');
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'pause' && row.enabled));
	assert.equal(f.editor.commands.isActive('pause', f.pane.commandTarget), true, 'the enabled action resumes the held runtime');
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'play.reveal'), false,
		'showing a separate Play session is View navigation, not the current game transport');
});

test('Actor Lab exposes the retained runtime timeline from the View command', async t => {
	const f = await fixture(t);
	assert.equal(f.group.timeline.visible, true);
	f.group.timeline.hide();
	assert.equal(f.editor.commands.isEnabled('runtime.toggleTimeline'), true);
	f.editor.commands.execute('runtime.toggleTimeline'); f.editor.update(0);
	assert.equal(f.group.timeline.requested, true);
	assert.equal(f.group.timeline.visible, true);
	assert.equal(f.editor.commands.isEnabled('runtime.playback', inputFocus.target), true);
	f.editor.commands.execute('runtime.playback'); await f.frame(); await f.frame();
	assert.equal(f.execution.paused, false);
	assert.equal(f.editor.commands.isActive('pause', f.pane.commandTarget), false);
});

for (const control of ['outliner', 'viewport', 'game'] as const) test(`Run menu resumes Actor Lab from its ${control} without leaving Studio`, async t => {
	const f = await fixture(t);
	if (control === 'viewport') { f.editor.commands.execute('sceneViewport.view2d', f.pane.commandTarget); await f.frame(); }
	const x = control === 'outliner' ? f.input.worldOutliner.tree.layout.contentLeft + 4 : f.input.previewBounds.right - 4;
	const y = control === 'outliner' ? f.input.worldOutliner.tree.layout.contentBottom - 4 : f.input.previewBounds.bottom - 4;
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true },
		{ type: 'button', button: 'primary', down: false }]);
	assert.equal(f.execution.paused, true, 'focus does not issue a playback request');
	const interaction = inputFocus.target!.scope.interaction!;
	const key = (code: string) => {
		f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none));
		f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false));
		f.editor.update(0);
	};
	f.editor.commands.execute('menubar.focus'); key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
	assert.equal(f.editor.menubar.activeMenu, 'run');
	const rows = f.editor.contextMenu.model.rows, index = rows.findIndex(row => row.command === 'pause');
	assert.ok(index >= 0 && rows[index].enabled && rows[index].active, 'the menu addresses the held Actor runtime');
	key('Home'); for (let i = 0; i < index; i++) if (rows[i].enabled) key('ArrowDown'); key('Enter');
	await f.frame(); await f.frame();
	assert.equal(f.editor.isActive, true);
	assert.equal(interaction.running, true);
	assert.equal(f.execution.paused, false);
	assert.equal(f.execution.userPaused, false);
});

for (const pause of ['editor hold', 'explicit pause'] as const) test(`Game viewport clicks preserve ${pause} until an explicit transport command`, async t => {
	const f = await fixture(t);
	if (pause === 'explicit pause') f.editor.commands.execute('runtime.pause', f.pane.commandTarget);
	const cycles = f.runtime.machine.scheduler.nowCycles, revision = f.execution.revision;
	const { left, top, right, bottom } = f.input.previewBounds;
	const click = () => f.native.apply([{ type: 'pointer', x: (left + right) / 2, y: (top + bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	click(); await f.frame(); await f.frame(); click(); await f.frame();
	const target = inputFocus.target!;
	assert.ok(target.guestInput !== undefined, 'the click still admits the ordinary game input recipient');
	assert.equal(f.input.interaction.running, false);
	assert.equal(f.execution.paused, true);
	assert.equal(f.execution.userPaused, pause === 'explicit pause');
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles);
	assert.equal(f.execution.revision, revision);
	assert.ok(target.scope.interaction === f.input.interaction, 'game input and transport use the same owning client');
	f.editor.commands.execute('runtime.playback', target); await f.frame(); await f.frame();
	assert.equal(f.input.interaction.running, true); assert.equal(f.execution.paused, false);
	assert.ok(f.runtime.machine.scheduler.nowCycles > cycles);
	click(); await f.frame(); assert.equal(f.execution.paused, false, 'focus does not pause an explicitly running client either');
	f.editor.commands.execute('runtime.pause', target); click(); await f.frame();
	assert.equal(f.input.interaction.running, false); assert.equal(f.execution.userPaused, true);
});

test('keyboard focus in Game does not resume; releasing game input leaves Space available to the editor transport', async t => {
	const f = await fixture(t), cycles = f.runtime.machine.scheduler.nowCycles;
	f.pane.focus();
	for (let step = 0; step < 20 && inputFocus.target?.guestInput === undefined; step++) {
		f.editor.dispatchKey(new KeyInputEvent('Tab', KeyModifier.none));
		f.editor.dispatchKey(new KeyInputEvent('Tab', KeyModifier.none, false, false)); f.editor.update(0);
	}
	assert.ok(inputFocus.target?.guestInput !== undefined);
	await f.frame(); assert.equal(f.execution.paused, true); assert.equal(f.input.interaction.running, false);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles);
	f.editor.dispatchKey(new KeyInputEvent('F1', KeyModifier.shift));
	f.editor.dispatchKey(new KeyInputEvent('F1', KeyModifier.shift, false, false));
	assert.ok(inputFocus.target?.guestInput === undefined);
	for (const running of [true, false]) {
		f.editor.dispatchKey(new KeyInputEvent('Space', KeyModifier.none));
		f.editor.dispatchKey(new KeyInputEvent('Space', KeyModifier.none, false, false));
		await f.frame(); await f.frame();
		assert.equal(f.input.interaction.running, running); assert.equal(f.execution.paused, !running);
	}
});

test('leaving a running Actor Lab through the IDE shortcut continues the game', async t => {
	const f = await fixture(t);
	assert.equal(f.execution.paused, true);
	assert.equal(f.execution.userPaused, false, 'the automatic editor hold is not a user pause');
	f.editor.commands.execute('actorLab.playback', f.pane.commandTarget); await f.frame(); await f.frame();
	assert.equal(f.input.interaction.running, true);
	assert.equal(f.execution.paused, false);
	toggleEditor(f.editor, f.sources, f.ide.overlayRenderer, f.runtime);
	assert.equal(f.editor.isActive, false);
	assert.equal(f.execution.paused, false);
	const cycles = f.runtime.machine.scheduler.nowCycles;
	await f.frame(); await f.frame();
	assert.ok(f.runtime.machine.scheduler.nowCycles > cycles);
});

test('closing Actor Lab without an explicit Pause releases only the editor hold', async t => {
	const f = await fixture(t);
	assert.equal(f.execution.userPaused, false);
	toggleEditor(f.editor, f.sources, f.ide.overlayRenderer, f.runtime);
	assert.equal(f.execution.paused, false);
});

test('leaving Actor Lab preserves an explicit transport pause', async t => {
	const f = await fixture(t);
	f.editor.commands.execute('runtime.pause', f.pane.commandTarget);
	assert.equal(f.execution.userPaused, true);
	toggleEditor(f.editor, f.sources, f.ide.overlayRenderer, f.runtime);
	await f.frame();
	assert.equal(f.execution.paused, true);
	assert.equal(f.execution.userPaused, true);
});
