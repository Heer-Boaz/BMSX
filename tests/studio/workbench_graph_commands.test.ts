import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { buildCommandQuickPickItems } from '../../ide/workbench/contrib/commands/quick_access';
import { WorkbenchGraphControl } from '../../ide/workbench/ui/graph/control';
import { createWorkbenchGraphEdge, createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import { Font } from '../../machine/ts/render/shared/bmsx_font';

const font = new Font({ variant: 'tiny' });
const COMMANDS = ['graph.fit', 'graph.frameSelection', 'graph.zoomIn', 'graph.zoomOut', 'graph.resetZoom'] as const;

function fixture(t: TestContext) {
	const first = createWorkbenchGraphNode(font, 'FIRST', 0, 0), second = createWorkbenchGraphNode(font, 'SECOND', 400, 200);
	const edge = createWorkbenchGraphEdge([20, 20, 400, 20, 400, 200]);
	const model = createWorkbenchGraphModel(font, [first, second], [edge]);
	const view = new WorkbenchGraphViewport(model);
	view.layout(0, 0, 384, 288);
	const focus = new InputFocusService(), capture = new PointerCaptureService(), semantic = focus.createTarget();
	const control = new WorkbenchGraphControl(focus, capture, new PointerHoverService(), undefined, semantic);
	control.focusTarget.commandContext = semantic;
	control.setInput(view); control.focusTarget.focus();
	t.after(() => control.dispose());
	return { first, second, edge, model, view, focus, capture, semantic, control };
}

function pointer(x: number, y: number, button = PointerButton.Auxiliary): PointerInputSnapshot {
	return { modifiers: KeyModifier.none, spaceDown: false, viewportX: x, viewportY: y, pressedButtons: button,
		justPressedButtons: button, justReleasedButtons: 0, valid: true, insideViewport: true };
}

test('native Fit resets manual reading without changing the selected graph subject and remains invocable while fitted', t => {
	const f = fixture(t);
	f.view.selection = f.second; f.view.pan(30, 20);
	assert.equal(f.view.cameraMode, 'manual');
	f.focus.executeCommand('graph.fit');
	assert.equal(f.view.cameraMode, 'fit');
	assert.equal(f.view.selection, f.second); assert.equal(f.view.model, f.model);
	assert.equal(f.control.focusTarget.getCommand('graph.fit')!.isEnabled(), true);
	assert.equal(f.control.focusTarget.getCommand('graph.fit')!.isChecked!(), true);
	f.focus.executeCommand('graph.fit');
	assert.equal(f.view.cameraMode, 'fit');
});

for (const kind of ['node', 'edge'] as const) test(`native Frame Selection frames only its current ${kind} without changing selection or geometry`, t => {
	const f = fixture(t), selected = kind === 'node' ? f.second : f.edge;
	f.view.selection = selected;
	let framed: typeof selected.bounds | undefined;
	const frame = f.view.frameBounds.bind(f.view);
	t.mock.method(f.view, 'frameBounds', bounds => { framed = bounds; frame(bounds); });
	f.focus.executeCommand('graph.frameSelection');
	assert.equal(framed, selected.bounds);
	assert.equal(f.view.cameraMode, 'manual');
	assert.equal(f.view.selection, selected); assert.equal(f.view.model, f.model);
});

for (const command of COMMANDS) test(`native ${command} ends its owned pan before changing the camera`, t => {
	const f = fixture(t);
	f.view.setZoom(0.5); f.view.selection = f.second;
	f.control.handlePointer(pointer(100, 100), 0);
	assert.equal(f.capture.active, true);
	assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), true);
	t.after(f.view.horizontalScrollbar.onDidScroll(() => assert.equal(f.capture.active, false)));
	t.after(f.view.verticalScrollbar.onDidScroll(() => assert.equal(f.capture.active, false)));
	f.focus.executeCommand(command);
	assert.equal(f.capture.active, false);
	const camera = f.view.captureViewState();
	assert.equal(f.capture.dispatch({ ...pointer(130, 120), justPressedButtons: 0 }, false, 20), false);
	assert.deepEqual(f.view.captureViewState(), camera);
	assert.equal(f.view.selection, f.second);
});

test('Reset Zoom exits automatic Fit even when its current scale is already 100 percent', t => {
	const f = fixture(t);
	f.view.layout(0, 0, 900, 600); f.view.frameAll();
	assert.equal(f.view.zoom, 1); assert.equal(f.view.cameraMode, 'fit');
	assert.equal(f.control.focusTarget.getCommand('graph.resetZoom')!.isEnabled(), true);
	f.focus.executeCommand('graph.resetZoom');
	assert.equal(f.view.zoom, 1); assert.equal(f.view.cameraMode, 'manual');
	assert.equal(f.control.focusTarget.getCommand('graph.resetZoom')!.isEnabled(), false);
});

test('a native scrollbar gesture leaves Fit before its first scroll publication', t => {
	const f = fixture(t), bar = f.view.horizontalScrollbar, track = bar.getTrack();
	assert.equal(f.view.cameraMode, 'fit');
	let observed = false;
	const release = bar.onDidScroll(() => { observed = true; assert.equal(f.view.cameraMode, 'manual'); }); t.after(release);
	f.control.handlePointer(pointer(track.right - 1, (track.top + track.bottom) / 2, PointerButton.Primary), 0);
	assert.equal(f.view.cameraMode, 'manual');
	assert.equal(observed, true);
	assert.equal(f.capture.active, true);
	release();
	f.focus.executeCommand('graph.fit');
	assert.equal(f.capture.active, false); assert.equal(f.view.cameraMode, 'fit');
});

test('a stationary pan press retains Fit; actual pan movement leaves Fit before writing either axis', t => {
	const f = fixture(t), press = pointer(100, 100);
	f.control.handlePointer(press, 0);
	f.control.handleCapturedPointer({ ...press, justPressedButtons: 0 }, 1);
	assert.equal(f.view.cameraMode, 'fit');
	t.after(f.view.horizontalScrollbar.onDidScroll(() => assert.equal(f.view.cameraMode, 'manual')));
	t.after(f.view.verticalScrollbar.onDidScroll(() => assert.equal(f.view.cameraMode, 'manual')));
	f.control.handleCapturedPointer({ ...press, viewportX: 120, viewportY: 130, justPressedButtons: 0 }, 2);
	assert.equal(f.view.cameraMode, 'manual');
});

for (const mode of ['fit', 'manual'] as const) for (const change of ['resize', 'translate'] as const)
	test(`${mode} pan allocation ${change} retires its old press anchor without changing camera or selection`, t => {
		const f = fixture(t);
		f.view.layout(0, 0, 903, 603); f.view.frameAll();
		if (mode === 'manual') f.view.setZoom(2);
		f.view.selection = f.second;
		const press = pointer(100, 100);
		f.control.handlePointer(press, 0);
		assert.equal(f.capture.active, true);
		const scale = f.view.zoom, revision = f.view.allocationRevision;
		if (change === 'resize') f.view.layout(0, 0, 703, 503);
		else f.view.layout(20, 30, 923, 633);
		assert.equal(f.view.zoom, scale, 'allocation invalidation is independent of zoom invalidation');
		assert.equal(f.view.allocationRevision, revision + 1);
		const camera = f.view.captureViewState();
		f.capture.dispatch({ ...press, justPressedButtons: 0 }, false, 1);
		assert.equal(f.capture.active, false);
		assert.deepEqual(f.view.captureViewState(), camera);
		assert.equal(f.view.selection, f.second);
		assert.equal(f.capture.dispatch({ ...press, viewportX: 120, justPressedButtons: 0 }, false, 2), false);
		f.control.handlePointer({ ...press, viewportX: 120, justPressedButtons: 0 }, 3);
		assert.equal(f.capture.active, false, 'a held tail is not a new pan press');
		assert.deepEqual(f.view.captureViewState(), camera);
		assert.equal(f.view.selection, f.second);
	});

for (const active of [false, true]) for (const change of ['resize', 'translate'] as const) for (const delivery of ['move', 'release'] as const)
	test(`${active ? 'active' : 'pending'} graph drag allocation ${change} cancels before reading ${delivery}`, t => {
		const f = fixture(t);
		f.view.layout(0, 0, 903, 603); f.view.frameAll();
		const counts = { starts: 0, overs: 0, drops: 0 };
		const feedback = { kind: 'node-insertion' as const, source: f.first, marker: { ...f.first.bounds },
			placement: 'between' as const, offsetX: 0, offsetY: 0, accepted: true };
		f.control.setInput(f.view, { begin: () => {
			counts.starts++;
			return { feedback, isCurrent: () => true, dragOver: () => { counts.overs++; }, drop: () => { counts.drops++; } };
		} });
		const press = pointer(f.view.graphToViewportX(f.first.bounds.left + 2),
			f.view.graphToViewportY(f.first.bounds.top + 2), PointerButton.Primary);
		f.control.handlePointer(press, 0);
		if (active) f.capture.dispatch({ ...press, viewportX: press.viewportX + 10, justPressedButtons: 0 }, false, 1);
		assert.equal(f.capture.active, true);
		assert.equal(counts.starts, active ? 1 : 0);
		const overs = counts.overs;
		if (change === 'resize') f.view.layout(0, 0, 703, 503);
		else f.view.layout(20, 30, 923, 633);
		const camera = f.view.captureViewState();
		f.capture.dispatch({ ...press, viewportX: press.viewportX + 30, justPressedButtons: 0,
			pressedButtons: delivery === 'release' ? 0 : PointerButton.Primary,
			justReleasedButtons: delivery === 'release' ? PointerButton.Primary : 0 }, false, 2);
		assert.equal(f.capture.active, false);
		assert.equal(f.control.dragFeedback, undefined);
		assert.deepEqual(counts, { starts: active ? 1 : 0, overs, drops: 0 });
		assert.equal(f.capture.dispatch({ ...press, pressedButtons: 0, justPressedButtons: 0,
			justReleasedButtons: PointerButton.Primary }, false, 3), false);
		assert.deepEqual(f.view.captureViewState(), camera);
		assert.equal(f.view.selection, f.first);
	});

test('allocation publication clears stationary graph hover without changing geometry or camera intent', t => {
	const f = fixture(t);
	f.view.layout(0, 0, 903, 603); f.view.frameAll();
	const hover = { ...pointer(f.view.graphToViewportX(f.first.bounds.left + 2),
		f.view.graphToViewportY(f.first.bounds.top + 2)), pressedButtons: 0, justPressedButtons: 0 };
	f.control.handlePointer(hover, 0);
	assert.equal(f.control.hover, f.first);
	f.view.layout(20, 30, 923, 633);
	const camera = f.view.captureViewState();
	f.control.update();
	assert.equal(f.control.hover, null);
	f.control.handlePointer(hover, 1);
	assert.notEqual(f.control.hover, f.first);
	assert.equal(f.view.model, f.model);
	assert.deepEqual(f.view.captureViewState(), camera);
});

test('ordinary temporal drag scrolling does not publish a new allocation or cancel its gesture', t => {
	const f = fixture(t);
	f.view.setZoom(1); f.view.scrollX = 0; f.view.scrollY = 0;
	let starts = 0;
	const feedback = { kind: 'node-insertion' as const, source: f.first, marker: { ...f.first.bounds },
		placement: 'between' as const, offsetX: 0, offsetY: 0, accepted: true };
	f.control.setInput(f.view, { begin: () => {
		starts++;
		return { feedback, isCurrent: () => true, dragOver() {}, drop() {} };
	} });
	const press = pointer(f.view.graphToViewportX(f.first.bounds.left + 2),
		f.view.graphToViewportY(f.first.bounds.top + 2), PointerButton.Primary);
	f.control.handlePointer(press, 0);
	f.capture.dispatch({ ...press, viewportX: f.view.bounds.right - 1,
		viewportY: (f.view.bounds.top + f.view.bounds.bottom) / 2, justPressedButtons: 0 }, false, 1);
	const revision = f.view.allocationRevision, scroll = f.view.scrollX;
	f.control.advanceDrag(101);
	assert.ok(f.view.scrollX > scroll);
	assert.equal(f.view.allocationRevision, revision);
	assert.equal(f.capture.active, true);
	assert.equal(f.control.dragFeedback, feedback);
	assert.equal(starts, 1);
	f.view.layout(0, 0, 384, 288);
	assert.equal(f.view.allocationRevision, revision, 'unchanged layout does not retire a gesture');
});

test('native framing and zoom admission ends for empty, pending and detached graph controls', t => {
	const f = fixture(t);
	assert.equal(f.control.focusTarget.getCommand('graph.frameSelection')!.isEnabled(), false);
	f.view.selection = f.second;
	f.view.setPendingModel(createWorkbenchGraphModel(font, [], []));
	for (const command of COMMANDS) assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), false);
	f.view.setModel(f.model, f.second);
	assert.equal(f.control.focusTarget.getCommand('graph.frameSelection')!.isEnabled(), true);
	f.view.setModel(createWorkbenchGraphModel(font, [], []), null);
	for (const command of COMMANDS) assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), false);
	f.view.setModel(f.model, f.second); f.control.clearInput();
	for (const command of COMMANDS) assert.equal(f.control.focusTarget.getCommand(command)!.isEnabled(), false);
});

test('Palette graph actions retain their native control instead of borrowing a semantic pane subject', t => {
	const f = fixture(t), field = f.focus.createTarget(f.semantic);
	field.commandContext = f.semantic;
	f.view.selection = f.second;
	for (const command of COMMANDS) f.semantic.registerCommand(command, { isEnabled: () => true, run: () => assert.fail('semantic pane is not the physical graph') });
	const commands = {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		isActive: () => false,
	} satisfies Parameters<typeof buildCommandQuickPickItems>[0];
	const items = buildCommandQuickPickItems(commands, f.control.focusTarget, f.semantic);
	for (const command of COMMANDS) {
		const item = items.find(candidate => candidate.command === command);
		assert.ok(item); assert.equal(item.target, f.control.focusTarget);
	}
	const fieldItems = buildCommandQuickPickItems(commands, field, f.semantic);
	assert.equal(fieldItems.some(item => COMMANDS.some(command => command === item.command)), false,
		'a physical graph command is not exported by semantic context to an unrelated field');
});
