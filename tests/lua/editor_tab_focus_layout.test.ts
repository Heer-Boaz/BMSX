import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import * as colors from '../../ide/common/constants';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { EditorTabStrip } from '../../ide/workbench/ui/tab/control';
import type { EditorTabDragHandler } from '../../ide/workbench/ui/tab/drag';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import type { EditorTabId } from '../../ide/workbench/ui/tab/id';

/** Geometry assertions exercise the strip's interval-reveal and retained paint contracts. */
function fixture(t: TestContext, count = 12) {
	const model = new EditorTabGroupModel(), copies: EditorTextModel[] = [], inputs: SceneEditorInput[] = [];
	const font = new EditorFont('tiny');
	let measurements = 0;
	const context = {
		font: font.renderFont(), tabBarHeight: font.lineHeight + 3, charAdvance: font.advance('M'),
		measureText(text: string) { measurements++; return font.measure(text); },
		measureTextRange(text: string, from: number, to: number) { measurements++; return font.measure(text.slice(from, to)); },
		drawText() {},
	};
	const parent = inputFocus.createTarget(null, new InputFocusScope(Symbol('focused tab layout')));
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const inertDragHandler: EditorTabDragHandler = { update() {}, drop() {}, clear() {} };
	const strip = new EditorTabStrip(model, context, { isEnabled: () => true, execute() {} }, parent,
		id => { model.activate(model.findById(id)!); return true; }, id => model.removeAt(model.indexOf(model.findById(id)!)),
		() => true, inertDragHandler, menu);
	for (let index = 0; index < count; index++) {
		const path = `focused-${index}.lua`;
		const copy = new EditorTextModel({ contextLabel: 'Focus layout', sourceFilePath: path,
			location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
			source: { type: 'lua', resid: path } }, 'lua', 'return {}');
		const input = new SceneEditorInput(copy); input.setLabel(`tab ${index}`, path);
		copies.push(copy); inputs.push(input); model.add(input, { pinned: true });
	}
	model.activate(inputs[0]);
	const bounds = { left: 11, top: 23, right: 267, bottom: 23 };
	const layout = (focused: EditorInput | null = null, hover: EditorTabId | null = null, dragging = false) =>
		strip.layoutState.layout(bounds, context, hover, dragging, focused);
	const item = (input: EditorInput) => strip.layoutState.items.peek(model.indexOf(input));
	const visible = (input: EditorInput) => {
		const tab = item(input).bounds, viewport = strip.layoutState.viewportBounds;
		assert.ok(tab.left >= viewport.left && tab.right <= viewport.right, 'the requested complete tab interval is visible');
	};
	t.after(() => {
		strip.dispose(); menu.dispose(); model.clear(); parent.release();
		for (const copy of copies) copy.dispose();
	});
	return { model, strip, inputs, bounds, context, layout, item, visible, measurements: () => measurements };
}

test('keyboard focus reveals its exact inactive tab independently of the active pane without replacing records or measurements', t => {
	const f = fixture(t), first = f.inputs[0], last = f.inputs.at(-1)!;
	f.layout();
	const records = Array.from(f.strip.layoutState.items), bounds = f.item(last).bounds, measured = f.measurements();
	assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.layout(last);
	f.visible(last);
	assert.ok(f.model.activeTab === first);
	assert.equal(f.item(first).active, true); assert.equal(f.item(first).focused, false);
	assert.equal(f.item(last).active, false); assert.equal(f.item(last).focused, true);
	assert.equal(f.strip.scrollbar.getScroll() > 0, true);
	assert.equal(f.measurements(), measured);
	assert.ok(f.item(last).bounds === bounds);
	for (let index = 0; index < records.length; index++) assert.ok(f.strip.layoutState.items.peek(index) === records[index]);
	f.layout(first); f.visible(first);
	assert.equal(f.item(first).focused, true); assert.equal(f.item(last).focused, false);
});

test('stationary keyboard focus, hover, harmless model publications and focus loss preserve manual tab scrolling', t => {
	const f = fixture(t), last = f.inputs.at(-1)!;
	f.layout(last); f.strip.scrollbar.setScroll(0);
	const measured = f.measurements();
	for (let frame = 0; frame < 100; frame++) f.layout(last, frame % 2 === 0 ? last.id : null);
	assert.equal(f.strip.scrollbar.getScroll(), 0);
	assert.equal(f.measurements(), measured);
	last.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	f.layout(last);
	assert.equal(f.item(last).dirty, true);
	assert.equal(f.strip.scrollbar.getScroll(), 0, 'dirty publication is not another keyboard-reveal request');
	f.layout(null); assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.layout(last); f.visible(last);
	const scroll = f.strip.scrollbar.getScroll();
	f.layout(null);
	assert.equal(f.strip.scrollbar.getScroll(), scroll, 'opening a menu must not reveal a different active pane on strip blur');
	assert.equal(f.item(last).focused, false);
});

test('focused interval and viewport changes reveal the retained exact input while drag scroll remains authoritative', t => {
	const f = fixture(t), focused = f.inputs[1];
	f.layout(focused);
	const measured = f.measurements();
	f.model.move(1, f.inputs.length - 1);
	f.layout(focused); f.visible(focused);
	assert.equal(f.measurements(), measured, 'reordering retains each input\'s measured label');
	f.bounds.right -= 64;
	f.layout(focused); f.visible(focused);
	f.strip.scrollbar.setScroll(0); f.layout(focused, null, true);
	assert.equal(f.strip.scrollbar.getScroll(), 0, 'a captured drag owns its own edge scrolling');
	f.layout(focused); assert.equal(f.strip.scrollbar.getScroll(), 0);
	f.strip.layoutState.clear();
	f.layout(focused); f.visible(focused);
});

test('tab paint consumes the retained focused entry and paints one shared-theme outline inside its actual bounds without revealing or measuring', t => {
	const f = fixture(t, 3), focused = f.inputs[1];
	f.layout(focused);
	const strokes: Parameters<typeof api.blit_rect>[] = [];
	t.mock.method(api, 'blit_rect', (...args: Parameters<typeof api.blit_rect>) => { strokes.push(args); });
	t.mock.method(api, 'fill_rect', () => {});
	t.mock.method(api, 'pushClipRect', () => {}); t.mock.method(api, 'popClipRect', () => {});
	const measured = f.measurements(), scroll = f.strip.scrollbar.getScroll(), revision = f.strip.layoutState.revision;
	const bounds = f.item(focused).bounds;
	for (const input of [focused, f.inputs[0]]) {
		f.layout(input); strokes.length = 0;
		f.strip.draw(f.context);
		const outlines = strokes.filter(stroke => stroke[5] === colors.COLOR_FOCUS_BORDER);
		assert.equal(outlines.length, 1);
		const [left, top, right, bottom] = outlines[0], entry = f.item(input);
		assert.ok(left > entry.bounds.left && top > entry.bounds.top && right < entry.bounds.right && bottom < entry.bounds.bottom);
	}
	assert.ok(f.item(focused).bounds === bounds);
	assert.equal(f.measurements(), measured); assert.equal(f.strip.scrollbar.getScroll(), scroll);
	assert.equal(f.strip.layoutState.revision, revision);
	f.layout(); strokes.length = 0; f.strip.draw(f.context);
	assert.equal(strokes.some(stroke => stroke[5] === colors.COLOR_FOCUS_BORDER), false, 'active selection alone has no keyboard-focus outline');
});
