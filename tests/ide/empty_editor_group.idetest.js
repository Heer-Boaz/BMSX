// Headless IDE test: an editor group without inputs is an ordinary workbench state.
// Run: npm run ide:test -- <gameromname> tests/ide/empty_editor_group.idetest.js
const LOG_LEVEL_ERROR = 3;
let pressId = 1;

const press = async (...codes) => {
	for (const code of codes) {
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: true, value: 1, timestamp: 0, pressId: pressId++ });
	}
	await t.frames(1);
	for (const code of codes) {
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: false, value: 0, timestamp: 0, pressId: pressId++ });
	}
	await t.frames(1);
};

const pointerAt = async (x, y) => {
	t.postInput({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x, y, timestamp: 0 });
	await t.frames(1);
};

const clickPointer = async () => {
	const id = pressId++;
	t.postInput({ type: 'button', deviceId: 'pointer:0', code: 'pointer_primary', down: true, value: 1, timestamp: 0, pressId: id });
	await t.frames(1);
	t.postInput({ type: 'button', deviceId: 'pointer:0', code: 'pointer_primary', down: false, value: 0, timestamp: 0, pressId: id });
	await t.frames(1);
};

const toggleWorkbench = () => press('ControlRight', 'ShiftRight');

const assertNoErrorsSince = (first, phase) => {
	for (let index = first; index < t.logMessageCount(); index += 1) {
		const message = t.logMessage(index);
		t.assert(message.level !== LOG_LEVEL_ERROR, `${phase} logged an error: ${message.message}`);
	}
};

await t.waitForCart();
await t.frames(30);
const firstLog = t.logMessageCount();

await toggleWorkbench();
t.assert(t.workbenchActive(), 'the workbench did not open');
t.assert(t.workbenchTabs().length > 0, 'the workbench did not start with its entry input');

for (let attempt = 0; attempt < 16 && t.workbenchTabs().length > 0; attempt += 1) {
	await press('ControlLeft', 'KeyW');
}
t.assert(t.workbenchTabs().length === 0, 'closing the last tab reopened an input instead of leaving the group empty');
t.assert(t.activeWorkbenchTab() === null, 'an empty group reported an active input');
await t.frames(2);
t.capture('empty editor group watermark');

// Every per-frame consumer and direct entry point of the editor area runs without an input.
await pointerAt(192, 150);
await clickPointer();
t.postInput({ type: 'axis1', deviceId: 'pointer:0', code: 'pointer_wheel', x: 120, timestamp: 0 });
await t.frames(2);
await press('ControlLeft', 'Tab');
await press('ControlLeft', 'KeyW');
await press('ControlLeft', 'ShiftLeft', 'KeyP');
await press('Escape');
assertNoErrorsSince(firstLog, 'the empty editor group');

// Reported failure: reopening the workbench over an empty group.
await toggleWorkbench();
t.assert(!t.workbenchActive(), 'the workbench did not close');
await toggleWorkbench();
t.assert(t.workbenchActive(), 'the workbench did not reopen over an empty group');
await t.frames(2);
t.assert(t.activeWorkbenchTab() === null, 'reopening the workbench fabricated an input');
assertNoErrorsSince(firstLog, 'reopening the workbench');

// A source stop presents its location from the empty group (cart.lua:155 is the entry loop's vblank wait).
await toggleWorkbench();
t.assert(!t.workbenchActive(), 'the workbench did not close before the source stop');
t.toggleBreakpoint('cart.lua', 155);
for (let frame = 0; frame < 120 && !t.debuggerStopped(); frame += 1) {
	await t.frames(1);
}
t.assert(t.debuggerStopped(), 'the entry loop breakpoint did not stop');
await t.frames(2);
const stopped = t.activeWorkbenchTab();
t.assert(t.workbenchActive() && stopped !== null && stopped.kind === 'code_editor',
	'the source stop did not present its location from the empty group');
t.assert(t.workbenchTabs().length === 1, 'presenting the source stop created extra inputs');
t.toggleBreakpoint('cart.lua', 155);
assertNoErrorsSince(firstLog, 'leaving the empty group');
