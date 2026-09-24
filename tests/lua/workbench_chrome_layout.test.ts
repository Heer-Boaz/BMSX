import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandId } from '../../ide/common/commands';
import { COLOR_STATUS_TEXT, HEADER_BUTTON_PADDING_X } from '../../ide/common/constants';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { api } from '../../ide/runtime/overlay_api';
import { getStatusMessageLines, refreshWorkbenchLayout, updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { renderTopBar, renderTopBarDropdown } from '../../ide/workbench/render/top_bar';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { layoutTopBar } from '../../ide/workbench/ui/top_bar/layout';
import { TOP_BAR_MENU_ENTRIES, TOP_BAR_MENUS } from '../../ide/workbench/ui/top_bar/menu';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext) {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorChromeState.openMenuId = null;
	const overlay = createHostOverlayFixture(384, 288);
	let measurements = 0, queries = 0;
	const active = new Set<EditorCommandId>(), disabled = new Set<EditorCommandId>();
	const labels: { text: string; x: number; y: number }[] = [];
	const context = {
		get viewportWidth() { return editorViewState.viewportWidth; },
		get headerHeight() { return editorViewState.headerHeight; },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get lineHeight() { return editorViewState.lineHeight; },
		measureText(text: string) { measurements++; return editorViewState.font.measure(text); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			labels.push({ text, x, y });
			api.blit_text_inline_with_font(text, x, y, z, color, editorViewState.font.renderFont());
		},
	};
	const commands = {
		isActive(command: EditorCommandId) { queries++; return active.has(command); },
		isEnabled(command: EditorCommandId) { queries++; return !disabled.has(command); },
	};
	const layout = () => layoutTopBar(commands, context);
	const paint = () => {
		labels.length = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderTopBar(context); renderTopBarDropdown(context);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	t.after(() => {
		editorChromeState.openMenuId = null; layout();
		editorFeedbackState.message.visible = false;
	});
	return { layout, paint, context, labels, active, disabled, measured: () => measurements, queried: () => queries };
}

test('top-bar layout publishes menu hits and command state; painting only consumes them', t => {
	const f = fixture(t);
	editorChromeState.openMenuId = 'run';
	f.active.add('pause'); f.disabled.add('stepFrame');
	f.layout();
	const menu = TOP_BAR_MENUS.run;
	const pause = menu.items.find(item => item.type === 'command' && item.command === 'pause')!;
	assert.equal(pause.type, 'command');
	if (pause.type !== 'command') assert.fail('pause command contribution');
	assert.equal(pause.label, 'Resume'); assert.equal(pause.active, true);
	const step = menu.items.find(item => item.type === 'command' && item.command === 'stepFrame')!;
	assert.equal(step.type, 'command');
	if (step.type !== 'command') assert.fail('frame command contribution');
	assert.equal(step.disabled, true);
	const dropdown = editorChromeState.menuDropdownBounds!;
	assert.equal(dropdown.top, f.context.headerHeight);
	let top = dropdown.top;
	for (const item of menu.items) {
		assert.equal(item.bounds.top, top);
		assert.equal(item.bounds.left, dropdown.left);
		assert.equal(item.bounds.right, dropdown.right);
		assert.ok(item.bounds.bottom > top);
		top = item.bounds.bottom;
	}
	assert.equal(dropdown.bottom, top);
	const hits = structuredClone(menu.items.map(item => item.bounds));
	const measured = f.measured(), queried = f.queried();
	f.paint(); f.paint();
	assert.equal(f.measured(), measured); assert.equal(f.queried(), queried);
	assert.deepEqual(menu.items.map(item => item.bounds), hits);
	assert.equal(editorChromeState.menuDropdownBounds, dropdown);
	for (const item of menu.items) {
		if (item.type !== 'command' || item.keybinding === undefined) continue;
		const label = f.labels.find(label => label.text === item.keybinding && label.y > item.bounds.top && label.y < item.bounds.bottom)!;
		assert.equal(label.x + editorViewState.font.measure(label.text), dropdown.right - HEADER_BUTTON_PADDING_X);
	}
	f.active.clear(); f.disabled.clear();
	f.paint();
	assert.equal(pause.label, 'Resume', 'paint does not republish presentation');
	f.layout();
	assert.equal(pause.label, 'Pause'); assert.equal(pause.active, false); assert.equal(step.disabled, false);
});

test('closed or unanchored menus have no hits or command queries; switching retires old hits', t => {
	const f = fixture(t);
	f.layout();
	assert.equal(f.queried(), 0);
	assert.equal(editorChromeState.menuDropdownBounds, null);
	editorChromeState.openMenuId = 'file'; f.layout();
	const file = TOP_BAR_MENUS.file;
	assert.ok(file.items.some(item => item.bounds.right > 0));
	editorChromeState.openMenuId = 'view'; f.layout();
	for (const item of file.items) assert.deepEqual(item.bounds, { left: 0, top: 0, right: 0, bottom: 0 });
	const view = TOP_BAR_MENUS.view;
	assert.ok(view.items.some(item => item.bounds.right > 0));
	editorViewState.viewportWidth = 12;
	const queried = f.queried(); f.layout();
	assert.equal(f.queried(), queried);
	assert.equal(editorChromeState.menuDropdownBounds, null);
	for (const item of view.items) assert.equal(item.bounds.right, 0);
	editorViewState.viewportWidth = 384; f.layout();
	assert.ok(editorChromeState.menuDropdownBounds!.right > 0);
	editorChromeState.openMenuId = null; f.layout();
	for (const item of view.items) assert.equal(item.bounds.right, 0);
	assert.equal(editorChromeState.menuDropdownBounds, null);
});

test('menu label measurements are retained and invalidated by font, not by paint or viewport size', t => {
	const f = fixture(t);
	editorChromeState.openMenuId = 'file'; f.layout();
	const measured = f.measured();
	const dropdown = editorChromeState.menuDropdownBounds!;
	const width = dropdown.right - dropdown.left;
	for (let index = 0; index < 100; index++) { f.layout(); f.paint(); }
	assert.equal(f.measured(), measured);
	editorViewState.viewportWidth = 256; f.layout();
	assert.equal(f.measured(), measured);
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); f.layout();
	assert.ok(f.measured() > measured);
	assert.ok(dropdown.right - dropdown.left > width);
	assert.equal(editorChromeState.menuDropdownBounds, dropdown);
	for (const entry of TOP_BAR_MENU_ENTRIES) {
		const bounds = editorChromeState.menuEntryBounds[entry.id];
		assert.equal(bounds.right - bounds.left, editorViewState.font.measure(entry.label) + HEADER_BUTTON_PADDING_X * 2);
	}
	const newMeasurements = f.measured(); f.paint(); f.layout();
	assert.equal(f.measured(), newMeasurements);
});

test('feedback expiry and font wrapping publish parent bounds before full-width child layout', t => {
	fixture(t);
	const child: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	editorViewState.viewportWidth = 128;
	showEditorMessage('This authored status message must wrap differently when the font changes', COLOR_STATUS_TEXT, 1);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child), true);
	const tinyLines = [...getStatusMessageLines()];
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child), true);
	const msxLines = [...getStatusMessageLines()];
	assert.ok(msxLines.length > tinyLines.length, 'same text and viewport do not imply same wrapping');
	assert.equal(child.bottom, 288 - editorViewState.baseBottomMargin - msxLines.length * editorViewState.lineHeight - 4);
	updateEditorMessage(1);
	refreshWorkbenchLayout();
	assert.equal(updateFullWidthWorkbenchLayout(child), true);
	assert.equal(child.bottom, 288 - editorViewState.baseBottomMargin);
	assert.deepEqual(getStatusMessageLines(), []);
	assert.equal(updateFullWidthWorkbenchLayout(child), false, 'unchanged parent layout has no child rebuild');
});
