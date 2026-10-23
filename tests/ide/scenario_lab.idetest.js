// Ordinary Scenario Lab commands and source/result navigation on shipped Nemesis tests.
// Run: npm run ide:test -- nemesis_s tests/ide/scenario_lab.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart();
t.openLuaSource('cart.lua'); t.command('pause'); t.command('scenarioLab'); await t.frames(3);
const tab = t.activeWorkbenchTab();
t.assert(tab.kind === 'scenario_lab', 'the Scenario Lab command did not open its actual contribution');
const view = tab.view, tests = view.testPane, results = view.resultPane;
const runtime = t.runtime(), sources = t.sourceState(), pausedAt = runtime.machine.scheduler.nowCycles;
const canonicalMedia = sources.currentBlua32Media, canonicalRom = sources.cartridgeSlots[0].rom;
const installedSources = sources.cartridgeSlots[0].installedBlua32Sources;
const retainedLayout = view.layout, retainedTests = tests.rows;
const isolated = () => {
	t.assert(t.runtime() === runtime && runtime.machine.scheduler.nowCycles === pausedAt
		&& sources.currentBlua32Media === canonicalMedia && sources.cartridgeSlots[0].rom === canonicalRom
		&& sources.cartridgeSlots[0].installedBlua32Sources === installedSources,
		'a test run mutated the paused authoring machine or installed canonical media');
	t.assert(t.workbenchActive() && t.activeWorkbenchTab() === tab, 'execution replaced the retained Scenario Lab input');
};
const action = async command => {
	const item = view.actionBar.items.find(item => item.command === command);
	t.assert(item.visible && !item.overflowed && item.enabled, `${command} is not physically available`);
	await click((item.bounds.left + item.bounds.right) / 2, (item.bounds.top + item.bounds.bottom) / 2);
};
const finish = async run => {
	for (let frame = 0; frame < 8000 && view.runActive; frame++) await t.frames(1);
	t.assert(!view.runActive && run.state !== 'running' && view.resultService.liveRun === null,
		'the accepted run never reached a terminal outcome: ' + JSON.stringify(run.items.map(item => ({ state: item.state, failures: item.failures }))));
	isolated();
};
const focusTests = async () => {
	await click(tests.layout.contentRight - 12, tests.layout.contentTop + tests.layout.rowHeight / 2);
	await press('Home');
	t.assert(view.focus === 'tests' && tests.selectionIndex === 0, 'ordinary input did not reach the project root');
};
const selectResult = async result => {
	await click(results.layout.contentRight - 12, results.layout.contentTop + results.layout.rowHeight / 2);
	await press('Home');
	const index = results.rows.findIndex(row => row.kind === 'result' && row.result === result);
	t.assert(index >= 0, 'retained result is missing from its actual expanded run');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	t.assert(view.focus === 'results' && results.rows[results.selectionIndex].result === result,
		'ordinary result navigation selected another historical case');
};
t.assert(view.layout.right - view.layout.left === 384 && tests.layout.contentLeft === 0 && results.layout.contentRight === 384,
	'Scenario Lab does not use the actual constrained 384-pixel workbench');
t.assert(tests.rows[0].kind === 'root' && results.rows.length === 0, 'discovery or empty result projection is incorrect');
await t.frames(3);
t.assert(view.layout === retainedLayout && tests.rows === retainedTests && tab.view === view,
	'idle frames replaced retained layout or discovery owners');
const pauseIndex = tests.rows.findIndex(row => row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua');
t.assert(pauseIndex >= 0, 'the real pause integration case is missing');
await press('Home');
for (let row = 0; row < pauseIndex; row++) await press('ArrowDown');
const pause = tests.rows[tests.selectionIndex].test;
t.assert(tests.selectedNodeId === pause.id && pause.caseName === 'input_pause_retains_simulation_and_music',
	'keyboard selection lost the actual source-derived case identity');
await capture('scenario-lab-selected-pause-tiny');
await press('Enter');
const code = t.activeWorkbenchTab();
t.assert(code.kind === 'code_editor' && code.workingCopy.resource.path === pause.resource.path
	&& code.workingCopy.resource.domain === pause.resource.domain
	&& code.context.view.cursorRow === pause.range.start.line - 1 && code.context.view.cursorColumn === pause.range.start.column - 1,
	'case activation lost its canonical source and exact authored range');
const pauseSource = code.workingCopy.buffer.getText();
t.command('scenarioLab'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === tab && tests.selectedNodeId === pause.id, 'Source return replaced the retained case selection');
await action('scenarioLab.run');
const passed = view.resultService.runs[0], passedResult = passed.items[0];
t.assert(view.runActive && passed.scopeId === pause.id && passed.mode === 'run' && passed.items.length === 1
	&& passedResult.test.id === pause.id && passedResult.source === pauseSource,
	'physical Run did not capture the selected case and canonical suite bytes');
await capture('scenario-lab-pause-preparing-tiny'); await finish(passed);
t.assert(passed.state === 'passed' && passedResult.state === 'passed' && passed.completedCount === 1
	&& passed.passedCount === 1 && passedResult.endTick > passedResult.startTick,
	'the real pause integration case did not execute to success: ' + JSON.stringify(passedResult.failures));
t.assert(results.rows.some(row => row.kind === 'result' && row.result === passedResult), 'completed case was not projected into result history');
await selectResult(passedResult); await capture('scenario-lab-passed-history-tiny');
const tinyInspectionSelection = results.selectionIndex;
t.command('scenarioLab.details'); await t.frames(2); await press('End'); await press('ArrowRight');
t.assert(results.selectionIndex === tinyInspectionSelection, 'result Details did not own keyboard source disclosure');
await capture('scenario-lab-captured-suite-source-tiny'); await press('Escape');
t.assert(results.rows[results.selectionIndex].result === passedResult, 'closing result Details changed the historical subject');

await press('ControlLeft', 'ShiftLeft', 'KeyT');
// Rerun retains the previous scope even though the ordinary test cursor now selects the project.
await focusTests();
const root = tests.rows[0].root;
await action('scenarioLab.rerun');
const rerun = view.resultService.runs[0];
t.assert(view.runActive && rerun !== passed && rerun.scopeId === pause.id && rerun.items.length === 1
	&& rerun.items[0].test.id === pause.id && rerun.items[0].source === pauseSource,
	'Rerun used the current project cursor instead of the exact previous case scope');
await action('scenarioLab.revealRun');
t.assert(tests.selectedNodeId === pause.id && view.focus === 'results'
	&& results.rows[results.selectionIndex].id === rerun.id, 'Reveal Run did not select the accepted run and its real case scope');
await capture('scenario-lab-rerun-msx');
await action('scenarioLab.cancel'); await finish(rerun);
t.assert(rerun.state === 'cancelled' && rerun.items.every(item => item.state === 'cancelled' || item.state === 'skipped')
	&& rerun.completedCount === rerun.items.length, 'Stop did not retain a complete cancellation outcome');
t.assert(passed.state === 'passed' && passedResult.source === pauseSource, 'rerun/cancellation mutated historical evidence');
await capture('scenario-lab-stopped-rerun-msx');
await selectResult(passedResult); await capture('scenario-lab-selected-historical-result-msx');
const msxInspectionSelection = results.selectionIndex;
t.command('scenarioLab.details'); await t.frames(2); await press('End'); await press('ArrowRight');
t.assert(results.selectionIndex === msxInspectionSelection, 'historical Details leaked source navigation into the result list');
await capture('scenario-lab-captured-suite-source-msx'); await press('Escape');

await focusTests();
const expectedCases = root.children.flatMap(module => module.children);
t.assert(expectedCases.length > 1, 'the shipped project has no real multi-case scope');
await action('scenarioLab.run');
const project = view.resultService.runs[0];
t.assert(view.runActive && project.scopeId === root.id && project.items.length === expectedCases.length,
	'project Run lost the current declaration membership');
for (let index = 0; index < expectedCases.length; index++)
	t.assert(project.items[index].test.id === expectedCases[index].id, 'project Run changed typed test identity or declaration order');
await action('scenarioLab.cancel'); await finish(project);
t.assert(project.state === 'cancelled' && project.completedCount === project.items.length
	&& project.items.every(item => item.state === 'cancelled' || item.state === 'skipped'),
	'project cancellation executed or discarded pending cases instead of retaining their outcomes');
t.assert(passed.state === 'passed' && view.resultService.runs.includes(passed)
	&& t.workbenchTabs().filter(input => input.kind === 'scenario_lab').length === 1,
	'new runs duplicated Scenario Lab or discarded the retained successful run');
await capture('scenario-lab-cancelled-project-msx'); isolated();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Scenario Lab workflow logged an error: ${t.logMessage(index).message}`);
