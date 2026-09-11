import assert from 'node:assert/strict';
import { PointerHoverService } from '../../../ide/input/pointer/hover';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import { InputFocusService } from '../../../ide/input/focus';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../../ide/workbench/ui/action_bar_control';
import { medianMilliseconds } from '../../helpers/performance';

const POLLS = 100000;
for (const depth of [1, 4, 16]) {
	const hover = new PointerHoverService();
	let enters = 0, leaves = 0;
	const targets = Array.from({ length: depth }, () => ({ onPointerEnter() { enters += 1; }, onPointerLeave() { leaves += 1; } }));
	const stationary = medianMilliseconds(() => {
		for (let poll = 0; poll < POLLS; poll += 1) {
			hover.beginDispatch();
			for (const target of targets) hover.visit(target);
			hover.endDispatch();
		}
	});
	assert.equal(enters, depth); assert.equal(leaves, 0);
	hover.clear(); assert.equal(leaves, depth);
	console.log(JSON.stringify({ depth, polls: POLLS, stationaryMicrosecondsPerPoll: stationary * 1000 / POLLS, enters, leaves }));
}

const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
const parent = focus.createTarget(), state = createWorkbenchActionBar('sourceEditReview.title');
layoutWorkbenchActionBar(state, 240, 10, 22, text => text.length * 4);
const commands = { isEnabled: () => true, execute: () => assert.fail('hover must not execute') };
const bar = new WorkbenchActionBarControl(focus, capture, hover, commands, parent);
bar.setInput(state, parent);
const bounds = state.items[0].bounds;
const pointer = { valid: true, insideViewport: true, viewportX: bounds.left + 2, viewportY: bounds.top + 2,
	pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 };
const action = medianMilliseconds(() => {
	for (let poll = 0; poll < POLLS; poll += 1) {
		hover.beginDispatch(); bar.handlePointer(pointer); hover.endDispatch();
	}
});
assert.equal(state.hoveredCommand, state.items[0].command);
bar.dispose(); assert.equal(state.hoveredCommand, null);
console.log(JSON.stringify({ polls: POLLS, actionMicrosecondsPerPoll: action * 1000 / POLLS }));
