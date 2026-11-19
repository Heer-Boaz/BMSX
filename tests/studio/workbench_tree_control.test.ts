import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchTreeControl } from '../../ide/workbench/ui/tree_control';
import { ScrollableWorkbenchTree } from '../../ide/workbench/ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';

function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService(), parent = focus.createTarget();
	parent.bindKeyboard(() => {});
	const state = new ScrollableWorkbenchTree<{ label: string }>(), selected: object[] = [];
	const control = new WorkbenchTreeControl(focus, capture, hover, parent, element => selected.push(element));
	const root = appendWorkbenchTreeNode(state, null, { label: 'Category' }, true);
	const child = appendWorkbenchTreeNode(state, root, { label: 'Child' });
	const sibling = appendWorkbenchTreeNode(state, null, { label: 'Second category' });
	rebuildWorkbenchTreeRows(state, root);
	const font = new EditorFont('tiny'), bounds = { left: 0, top: 0, right: 100, bottom: 60 };
	control.setInput(state); control.layout(bounds, font);
	const key = (code: string) => {
		focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none));
		focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	t.after(() => control.dispose());
	return { focus, control, state, root, child, sibling, selected, font, bounds, key };
}

test('navigation tree shares hierarchy navigation and selects the actual retained element', t => {
	const f = fixture(t); f.control.focusTarget.focus();
	f.key('ArrowRight'); assert.equal(f.root.collapsed, false); assert.equal(f.selected.length, 0);
	f.key('ArrowRight'); assert.ok(f.selected.at(-1) === f.child.element);
	f.key('ArrowLeft'); assert.ok(f.selected.at(-1) === f.root.element);
	f.key('ArrowLeft'); assert.equal(f.root.collapsed, true);
	f.key('End'); assert.ok(f.selected.at(-1) === f.sibling.element);
	f.control.clearInput(); assert.ok(f.focus.admittedTarget !== f.control.focusTarget);
});

test('tree layout reuses measured rows across resize and scroll, invalidating only for changed rows or font', t => {
	const f = fixture(t), measure = t.mock.method(f.font, 'measureTextRange');
	const count = measure.mock.callCount();
	f.control.layout(f.bounds, f.font); f.control.layout({ ...f.bounds, right: f.bounds.right / 2 }, f.font);
	f.state.scrollbar.setScroll(1); f.control.layout(f.bounds, f.font);
	assert.equal(measure.mock.callCount(), count);
	f.sibling.element.label += ' renamed'; f.state.onDidChangeRows(); f.control.layout(f.bounds, f.font);
	assert.equal(measure.mock.callCount() - count, f.state.rows.length);
});

test('pointer focus cannot select a tree retired by that focus transition', t => {
	const f = fixture(t), other = f.focus.createTarget(); other.bindKeyboard(() => {}); other.focus();
	other.onDidBlur(() => f.control.clearInput());
	const layout = f.state.layout;
	f.control.handlePointer({ valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false,
		viewportX: layout.contentLeft + layout.twistieWidth + 1, viewportY: layout.contentTop + layout.rowHeight / 2,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.selected.length, 0);
});
