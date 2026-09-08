// Exercise the shipped cinematic scenario, not a synthetic guest or command map.
let pressId = 1;
const press = async (...codes) => {
	for (const code of codes) {
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code,
			down: true, value: 1, timestamp: 0, pressId: pressId++ });
	}
	await t.frames(2);
	for (const code of codes) {
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code,
			down: false, value: 0, timestamp: 0, pressId: pressId++ });
	}
	await t.frames(2);
};
const palette = async query => {
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	for (const character of query) {
		await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	}
	await press('Enter');
};

await t.waitForCart();
const runtime = t.runtime();
const sources = t.sourceState();
const canonicalMedia = sources.currentBlua32Media;
const canonicalRom = sources.cartridgeSlots[0].rom.bytes;
t.openLuaSource('cart.lua');
t.command('pause');
await palette('scenario lab');
const tab = t.activeWorkbenchTab();
t.assert(tab.kind === 'scenario_lab', 'Command Palette did not open Scenario Lab');
const view = tab.view;
const index = view.testPane.rows.findIndex(row => row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_cinematic_flow_assert.lua');
t.assert(index >= 0, 'actual cinematic scenario is missing');
await press('Home');
for (let row = 0; row < index; row++) await press('ArrowDown');
t.assert(view.testPane.selectionIndex === index, 'keyboard did not select the cinematic scenario');
await palette('run scenarios');
t.assert(view.runActive && !t.workbenchActive(), 'Run Scenarios did not start through the Palette');
const run = view.resultService.runs[0];
const result = run.items[0];
for (let frame = 0; frame < 1200; frame++) {
	if (result.logs.length > 0 && result.logs.at(result.logs.length - 1).text === 'gameplay ready') break;
	await t.frames(1);
}
t.assert(result.state === 'running' && result.logs.at(result.logs.length - 1).text === 'gameplay ready',
	'cinematic scenario did not reach its real setup phase');
await t.frames(4);
await press('ControlRight', 'ShiftRight');
t.assert(t.workbenchActive() && t.activeWorkbenchTab() === tab,
	'host IDE chord did not interrupt the cinematic scenario');
const stoppedAt = runtime.machine.scheduler.nowCycles;
await t.frames(4);
t.assert(runtime.machine.scheduler.nowCycles === stoppedAt, 'IDE did not suspend the running scenario');
await palette('cancel run');
for (let frame = 0; frame < 300 && view.runActive; frame++) await t.frames(1);
t.assert(!view.runActive && run.state === 'cancelled' && result.state === 'cancelled',
	'Cancel Run did not complete through the Palette');
t.assert(t.runtime() === runtime && sources.currentBlua32Media === canonicalMedia
	&& sources.cartridgeSlots[0].rom.bytes === canonicalRom,
	'cancel did not restore the canonical media on the same runtime');
t.assert(t.workbenchActive() && t.activeWorkbenchTab() === tab,
	'cancel did not return to the originating Scenario Lab input');
