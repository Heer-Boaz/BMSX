import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { renderTabBar } from '../../ide/workbench/render/tab_bar';
import { beginTabDrag, endTabDrag } from '../../ide/workbench/ui/tab/drag';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../ide/common/models';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const primary = PointerButton.Primary;
const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
});

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 384) {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
	editorTabGroup.clear();
	const models: EditorTextModel[] = [];
	const add = (label: string, preview = false) => {
		const model = new EditorTextModel({ domain: 0, path: label + '.lua', source: { type: 'lua', resid: label } }, 'lua', 'return {}');
		models.push(model);
		const input = new SceneEditorInput(model); input.setLabel(label, model.resource.path);
		editorTabGroup.add(input, { pinned: !preview }); editorTabGroup.activate(input);
		return input;
	};
	const overlay = createHostOverlayFixture(width, 288);
	let measuredLabels = 0, drawnLabels = 0;
	const context = {
		viewportWidth: width, headerHeight: editorViewState.headerHeight,
		tabBarHeight: editorViewState.tabBarHeight, lineHeight: editorViewState.lineHeight,
		measureText(text: string) { if (text !== 'x') measuredLabels += 1; return editorViewState.font.measure(text); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			drawnLabels += 1;
			api.blit_text_inline_with_font(text, x, y, z, color, editorViewState.font.renderFont());
		},
	};
	const draw = () => {
		drawnLabels = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		const height = renderTabBar(context); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		return height;
	};
	t.after(() => {
		endTabDrag(); pointerCapture.cancel(); editorTabGroup.clear();
		for (const model of models) model.dispose();
	});
	return { add, draw, context, measured: () => measuredLabels, drawn: () => drawnLabels, bar: editorChromeState.tabScrollbar };
}

for (const variant of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`tabs use a bounded horizontal strip and retained labels at ${variant}/${width}`, t => {
		const f = fixture(t, variant, width);
		const first = f.add('first'); f.draw();
		assert.equal(f.bar.isVisible(), false);
		for (let i = 0; i < 40; i += 1) f.add(`FSM definition ${i}`);
		const last = editorTabGroup.activeTab!;
		assert.equal(f.draw(), f.context.tabBarHeight + SCROLLBAR_WIDTH);
		assert.equal(f.bar.isVisible(), true);
		const lastBounds = editorChromeState.tabButtonBounds.get(last.id)!;
		assert.ok(lastBounds.left >= 0 && lastBounds.right <= width);
		const labels = f.measured();
		f.bar.setScroll(0); f.draw();
		for (let i = 0; i < 100; i += 1) f.draw();
		assert.equal(f.bar.getScroll(), 0, 'stationary rendering does not undo manual scrolling');
		assert.equal(f.measured(), labels, 'tab labels are not remeasured per frame');
		assert.ok(f.drawn() < 8, 'offscreen tabs emit no glyphs');
		editorTabGroup.activate(last); f.draw();
		assert.ok(f.bar.getScroll() > 0, 'explicit reactivation reveals an already active tab');
		assert.equal(editorChromeState.tabButtonBounds.get(last.id), lastBounds, 'geometry is retained');
		editorTabGroup.activate(first); f.draw();
		assert.ok(editorChromeState.tabButtonBounds.get(first.id)!.left >= 0);
		editorTabGroup.removeAt(editorTabGroup.indexOf(last));
		assert.equal(editorChromeState.tabButtonBounds.has(last.id), false);
		assert.equal(editorChromeState.tabCloseButtonBounds.has(last.id), false, 'closed input geometry ends with its lifetime');
	});
}

test('tab capture previews its insertion and commits only an accepted physical drop', t => {
	const f = fixture(t); const a = f.add('A'), b = f.add('B'), c = f.add('C');
	editorTabGroup.activate(a); f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(a.id)!;
	const y = bounds.top + 1;
	beginTabDrag(a.id, pointer(bounds.left + 2, y, primary, primary), 0);
	assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch(pointer(200, y, primary), false, 20); f.draw();
	assert.equal(editorChromeState.tabDragState!.targetIndex, 2);
	assert.deepEqual(editorTabGroup.tabs, [a, b, c], 'hovering a destination is not a reorder');
	pointerCapture.dispatch(pointer(200, y, 0, 0, primary), false, 40);
	assert.deepEqual(editorTabGroup.tabs, [b, c, a]); assert.equal(pointerCapture.active, false);
	f.draw();
	beginTabDrag(a.id, pointer(bounds.left + 2, y, primary, primary), 50);
	pointerCapture.dispatch(pointer(0, y, primary), false, 60); f.draw();
	assert.equal(editorChromeState.tabDragState!.targetIndex, 0);
	pointerCapture.cancel();
	assert.deepEqual(editorTabGroup.tabs, [b, c, a], 'Escape/capture loss needs no rollback');
	assert.equal(editorChromeState.tabDragState, null);
});

test('a tab drag pins its preview, scrolls in host time and cancels on model/lifetime changes', t => {
	const f = fixture(t); for (let i = 0; i < 20; i += 1) f.add(`definition ${i}`);
	const preview = f.add('preview', true); f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(preview.id)!;
	const y = bounds.top + 1;
	beginTabDrag(preview.id, pointer(bounds.left + 2, y, primary, primary), 0);
	pointerCapture.dispatch(pointer(1, y, primary), false, 10); f.draw();
	assert.equal(editorTabGroup.previewTab, null);
	const scroll = f.bar.getScroll();
	pointerCapture.dispatch(pointer(1, y, primary), false, 1010); f.draw();
	assert.ok(f.bar.getScroll() < scroll - 100, 'holding the edge scrolls while the machine can remain paused');
	const order = [...editorTabGroup.tabs];
	pointerCapture.dispatch(pointer(1, y, primary), true, 1020);
	assert.equal(pointerCapture.active, false); assert.deepEqual(editorTabGroup.tabs, order);
	beginTabDrag(preview.id, pointer(200, y, primary, primary), 1100);
	editorTabGroup.removeAt(editorTabGroup.indexOf(preview));
	pointerCapture.dispatch(pointer(1, y, 0, 0, primary), false, 1120);
	assert.equal(pointerCapture.active, false); assert.equal(editorChromeState.tabDragState, null);
});
