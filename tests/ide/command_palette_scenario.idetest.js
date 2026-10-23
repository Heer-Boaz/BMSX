// Shipped cinematic case, real Palette Run/Stop, and an isolated physical test target.
// Run: npm run ide:test -- nemesis_s tests/ide/command_palette_scenario.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const palette = async query => {
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	for (const character of query) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	await press('Enter');
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart();
const runtime = t.runtime(), sources = t.sourceState();
const canonicalMedia = sources.currentBlua32Media, canonicalRom = sources.cartridgeSlots[0].rom;
const installedSources = sources.cartridgeSlots[0].installedBlua32Sources;
t.openLuaSource('cart.lua'); t.command('pause');
await palette('scenario lab');
const tab = t.activeWorkbenchTab();
t.assert(tab.kind === 'scenario_lab', 'Command Palette did not open Scenario Lab');
const view = tab.view, pausedAt = runtime.machine.scheduler.nowCycles;
const index = view.testPane.rows.findIndex(row => row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_cinematic_flow_assert.lua');
t.assert(index >= 0, 'actual cinematic scenario is missing');
const test = view.testPane.rows[index].test;
await press('Home');
for (let row = 0; row < index; row++) await press('ArrowDown');
t.assert(view.testPane.selectedNodeId === test.id, 'keyboard navigation lost the actual cinematic case identity');
const isolated = () => {
	t.assert(t.runtime() === runtime && runtime.machine.scheduler.nowCycles === pausedAt
		&& sources.currentBlua32Media === canonicalMedia && sources.cartridgeSlots[0].rom === canonicalRom
		&& sources.cartridgeSlots[0].installedBlua32Sources === installedSources,
		'the isolated case changed the paused authoring machine or installed canonical media');
	t.assert(t.workbenchActive() && t.activeWorkbenchTab() === tab, 'automatic execution replaced the originating workbench');
};
let previous;
for (let font = 0; font < 2; font++) {
	const variant = view.layout.font.variant;
	await palette('run scenarios');
	const run = view.resultService.runs[0], result = run.items[0];
	t.assert(view.runActive && run !== previous && run.state === 'running' && run.mode === 'run'
		&& run.scopeId === test.id && run.items.length === 1 && result.test.id === test.id,
		'Palette Run did not admit exactly the selected source-bound cinematic case');
	isolated(); await capture(`scenario-palette-${variant}-admitted`);
	for (let frame = 0; frame < 6000 && result.state !== 'running' && view.runActive; frame++) await t.frames(1);
	t.assert(view.runActive && result.state === 'running' && result.endTick === null,
		'cinematic case did not enter its independent physical target: ' + JSON.stringify(result.failures));
	isolated(); await capture(`scenario-palette-${variant}-running`);
	await palette('stop scenarios');
	for (let frame = 0; frame < 1200 && view.runActive; frame++) await t.frames(1);
	t.assert(!view.runActive && run.state === 'cancelled' && result.state === 'cancelled'
		&& result.endTick !== null && run.cancelledCount === 1 && run.completedCount === 1,
		'Palette Stop did not retire that exact run and its active case');
	t.assert(view.resultService.runs[0] === run && view.resultService.liveRun === null,
		'Stop targeted another run or left live execution behind');
	isolated(); await capture(`scenario-palette-${variant}-stopped`);
	previous = run;
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Palette Scenario workflow logged an error: ${t.logMessage(index).message}`);
