const pressKey = async (code, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const pressModifiedF5 = async (modifier, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code: modifier,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code: 'F5',
		down: true,
		value: 1,
		timestamp: 0,
		pressId: pressId + 1,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code: 'F5',
		down: false,
		value: 0,
		timestamp: 0,
		pressId: pressId + 1,
	});
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code: modifier,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const clickPointer = async (x, y, pressId) => {
	t.postInput({
		type: 'axis2',
		deviceId: 'pointer:0',
		code: 'pointer_position',
		x,
		y,
		timestamp: 0,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const releasePointer = async (pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const waitForRunToFinish = async (view, limit) => {
	for (let frame = 0; frame < limit; frame += 1) {
		if (!view.runActive) {
			return;
		}
		await t.frames(1);
	}
	throw new Error('Scenario Lab run did not restore canonical media');
};

await t.waitForCart();
await t.frames(4);
const runtime = t.runtime();
const cpu = runtime.machine.cpu;
const sources = t.sourceState();
const canonicalMedia = sources.currentBlua32Media;
const canonicalCartridge = sources.cartridgeSlots[0].rom;

t.openLuaSource('cart.lua');
await t.frames(2);
await clickPointer(64, 4, 10);
await releasePointer(10);
await clickPointer(64, 20, 11);
await releasePointer(11);
await t.frames(2);
const labTab = t.activeWorkbenchTab();
t.assert(labTab.kind === 'scenario_lab', 'View menu did not activate the Scenario Lab workbench input');
const view = labTab.view;
const testPane = view.testPane;
const resultPane = view.resultPane;
const retainedRows = testPane.rows;
const retainedLayout = view.layout;
const retainedTestLayout = testPane.layout;
const retainedResultLayout = resultPane.layout;
t.assert(view.layout.viewportWidth === 384 && view.layout.viewportHeight === 288, 'Scenario Lab did not use the constrained IDE viewport');
t.assert(view.layout.font.variant === 'tiny' && view.layout.rowHeight === 6, 'Scenario Lab did not use tiny IDE font metrics');
t.assert(testPane.layout.contentLeft === 0 && resultPane.layout.contentRight === 384, 'Scenario Lab panes do not own the full workbench content width');
t.assert(testPane.rows.length > 1 && testPane.rows[0].kind === 'root', 'Scenario Lab did not project the packaged test tree');
t.assert(resultPane.rows.length === 0, 'new Scenario Lab input contains phantom results');

await t.frames(3);
t.assert(t.activeWorkbenchTab() === labTab && labTab.view === view, 'unchanged frames replaced the Scenario Lab editor input');
t.assert(view.testPane === testPane && view.resultPane === resultPane, 'unchanged frames replaced retained Scenario Lab panes');
t.assert(view.layout === retainedLayout && testPane.layout === retainedTestLayout && resultPane.layout === retainedResultLayout, 'unchanged frames replaced retained Scenario Lab layouts');
t.assert(testPane.rows === retainedRows, 'unchanged frames replaced the retained test projection');

const testRowIndex = testPane.rows.findIndex(row =>
	row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua');
t.assert(testRowIndex >= 0, 'packaged pause scenario is missing from the test tree');
const testRowY = testPane.layout.contentTop
	+ (testRowIndex - testPane.scroll) * view.layout.rowHeight
	+ 1;
await clickPointer(testPane.layout.contentLeft + 40, testRowY, 20);
t.assert(testPane.selectionIndex === testRowIndex, 'pointer did not select the requested scenario');
await releasePointer(20);
await pressKey('ArrowUp', 21);
await pressKey('ArrowDown', 22);
t.assert(testPane.selectionIndex === testRowIndex, 'keyboard navigation did not select the requested scenario');
t.assert(testPane.selectedTestId === testPane.rows[testRowIndex].test.id, 'test selection lost its stable identity');
t.capture('scenario-lab-tests-tiny-384x288');

const runAction = view.actionBar.items[0];
t.assert(runAction.command === 'scenarioLab.run', 'Scenario Lab title menu did not contribute the run command');
const runBounds = runAction.bounds;
await clickPointer(
	runBounds.left + 1,
	runBounds.top + 1,
	100,
);
await releasePointer(100);
t.assert(view.runActive, 'Run action did not start the selected scenario');
await waitForRunToFinish(view, 1200);
await t.frames(2);

t.assert(t.runtime() === runtime && runtime.machine.cpu === cpu, 'Scenario Lab replaced the live runtime');
t.assert(sources.currentBlua32Media === canonicalMedia, 'Scenario Lab did not restore canonical tooling media');
t.assert(sources.cartridgeSlots[0].rom === canonicalCartridge, 'Scenario Lab replaced the canonical cartridge source');
t.assert(t.activeWorkbenchTab() === labTab, 'completed run did not return to the same Scenario Lab input');
t.assert(resultPane.rows.length >= 4, 'completed run did not project its retained logs and capture');
t.assert(resultPane.rows[0].result.state === 'passed', 'pause scenario did not pass');
t.assert(resultPane.rows[0].expanded, 'new result was not expanded');
t.assert(resultPane.selectionIndex === 0, 'new result did not become the retained result selection');
const fsmTrace = resultPane.rows[0].result.fsmTransitionTrace;
t.assert(fsmTrace !== null, 'pause scenario did not bind its selected FSM recorder');
t.assert(fsmTrace.executionDomain === 0, 'FSM trace lost its cartridge execution domain');
t.assert(fsmTrace.instanceId === 'nemesis_s.director.nemesis_s.director.fsm', 'FSM trace selected the wrong concrete machine instance');
t.assert(fsmTrace.machineId === 'nemesis_s.director.fsm', 'FSM trace lost its semantic machine id');
t.assert(fsmTrace.transitions.length === 2, 'pause scenario did not record exactly the pause and resume transitions');
const pauseTransition = fsmTrace.transitions.at(0);
const resumeTransition = fsmTrace.transitions.at(1);
t.assert(pauseTransition.outcome === 'committed'
	&& pauseTransition.fromDefId === 'nemesis_s.director.fsm:/gameplay/running'
	&& pauseTransition.toDefId === 'nemesis_s.director.fsm:/gameplay/pause',
'first FSM fact is not the committed running-to-pause transition');
t.assert(resumeTransition.outcome === 'committed'
	&& resumeTransition.fromDefId === 'nemesis_s.director.fsm:/gameplay/pause'
	&& resumeTransition.toDefId === 'nemesis_s.director.fsm:/gameplay/running',
'second FSM fact is not the committed pause-to-running transition');
t.assert(pauseTransition.producerSequence === 1
	&& resumeTransition.producerSequence === 2
	&& pauseTransition.observedTick <= resumeTransition.observedTick,
'FSM fact ordering did not retain producer sequence and host observation tick separately');
t.assert(resultPane.rows.some(row => row.kind === 'fsm_transition' && row.transition === pauseTransition),
'Scenario Lab did not project recorded FSM facts');
t.capture('scenario-lab-passed-result-tiny-384x288');

const actionEffectTestRowIndex = testPane.rows.findIndex(row =>
	row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_msx_weapons_assert.lua');
t.assert(actionEffectTestRowIndex >= 0, 'packaged ActionEffect scenario is missing from the test tree');
let navigationPressId = 200;
while (testPane.selectionIndex < actionEffectTestRowIndex) {
	await pressKey('ArrowDown', navigationPressId);
	navigationPressId += 1;
}
while (testPane.selectionIndex > actionEffectTestRowIndex) {
	await pressKey('ArrowUp', navigationPressId);
	navigationPressId += 1;
}
t.assert(testPane.selectedTestId === testPane.rows[actionEffectTestRowIndex].test.id,
'keyboard navigation did not select the ActionEffect scenario');
await clickPointer(
	runBounds.left + 1,
	runBounds.top + 1,
	300,
);
await releasePointer(300);
t.assert(view.runActive, 'Run action did not start the ActionEffect scenario');
await waitForRunToFinish(view, 1200);
await t.frames(2);

const actionEffectResult = resultPane.rows[0].result;
t.assert(actionEffectResult.state === 'passed', 'ActionEffect scenario did not pass');
const actionEffectTrace = actionEffectResult.actionEffectTrace;
t.assert(actionEffectTrace !== null, 'ActionEffect scenario did not bind its selected recorder');
t.assert(actionEffectTrace.executionDomain === 0, 'ActionEffect trace lost its cartridge execution domain');
t.assert(actionEffectTrace.ownerId === 'nemesis_s.player.1'
	&& actionEffectTrace.ownerDefinitionId === 'nemesis_s.player',
'ActionEffect trace selected the wrong concrete component owner');
t.assert(actionEffectTrace.facts.length === 3,
'ActionEffect trace did not retain the fire down/up activity boundaries');
const fireActivation = actionEffectTrace.facts.at(0);
const fireTrigger = actionEffectTrace.facts.at(1);
const fireDeactivation = actionEffectTrace.facts.at(2);
t.assert(fireActivation.kind === 'activate'
	&& fireActivation.effectId === 'fire_salvo'
	&& fireActivation.activeCount === 1,
'ActionEffect trace did not retain the committed fire activation');
t.assert(fireTrigger.kind === 'trigger'
	&& fireTrigger.effectId === 'fire_salvo'
	&& fireTrigger.outcome === 'accepted',
'ActionEffect trace did not retain the direct accepted fire outcome');
t.assert(fireDeactivation.kind === 'deactivate'
	&& fireDeactivation.effectId === 'fire_salvo'
	&& fireDeactivation.activeCount === 0,
'ActionEffect trace did not retain the committed fire deactivation');
t.assert(fireActivation.producerSequence === 1
	&& fireTrigger.producerSequence === 2
	&& fireDeactivation.producerSequence === 3,
'ActionEffect trace lost the producer order across activity and trigger facts');
t.assert(resultPane.rows.some(row => row.kind === 'actioneffect_fact' && row.fact === fireTrigger),
'Scenario Lab did not project recorded ActionEffect facts');
t.capture('scenario-lab-actioneffect-result-tiny-384x288');

await pressKey('Tab', 310);
t.assert(view.focus === 'results', 'Tab did not move focus to result history');
const fireFactRowIndex = resultPane.rows.findIndex(row =>
	row.kind === 'actioneffect_fact' && row.fact === fireTrigger);
t.assert(fireFactRowIndex > 0, 'accepted fire fact is missing from result navigation');
while (resultPane.selectionIndex < fireFactRowIndex) {
	await pressKey('ArrowDown', navigationPressId);
	navigationPressId += 1;
}
await pressKey('Enter', navigationPressId);
navigationPressId += 1;
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'ActionEffect fact activation did not open source');
t.assert(t.activeEditorDocument().model.resource.path === 'player/actioneffects.lua', 'ActionEffect fact activation opened the wrong registration resource');
t.assert(t.activeEditorDocument().view.cursorRow === 15, 'ActionEffect fact activation did not select the fire_salvo registration');

t.command('scenarioLab');
await t.frames(2);
t.assert(t.activeWorkbenchTab() === labTab && labTab.view === view, 'source navigation replaced the retained Scenario Lab input');
const firstLogRowIndex = resultPane.rows.findIndex(row => row.kind === 'log');
t.assert(firstLogRowIndex > 0, 'completed ActionEffect scenario has no retained log');
while (resultPane.selectionIndex > firstLogRowIndex) {
	await pressKey('ArrowUp', navigationPressId);
	navigationPressId += 1;
}
while (resultPane.selectionIndex < firstLogRowIndex) {
	await pressKey('ArrowDown', navigationPressId);
	navigationPressId += 1;
}
const detailRow = resultPane.rows[resultPane.selectionIndex];
t.assert(detailRow.kind === 'log', 'result navigation did not reach the first retained log');
await pressKey('Enter', navigationPressId);
navigationPressId += 1;
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'result activation did not open source');
t.assert(t.activeEditorDocument().model.resource.path === detailRow.location.resource.path, 'result activation opened the wrong source resource');

t.command('scenarioLab');
await t.frames(2);
t.assert(t.activeWorkbenchTab() === labTab && labTab.view === view, 'reopening duplicated the Scenario Lab input or view');
await pressModifiedF5('ControlLeft', 320);
t.assert(view.runActive, 'Ctrl+F5 did not rerun the selected scenario');

t.openLuaSource('cart.lua');
await t.frames(1);
t.command('scenarioLab');
await t.frames(1);
await pressModifiedF5('ShiftLeft', 330);
await waitForRunToFinish(view, 1200);
await t.frames(2);

t.assert(resultPane.rows[0].result.state === 'cancelled', 'Shift+F5 did not cancel the active scenario');
t.assert(sources.currentBlua32Media === canonicalMedia, 'cancel did not restore canonical tooling media');
t.assert(t.activeWorkbenchTab() === labTab, 'cancel did not return to the retained Scenario Lab input');
t.assert(t.workbenchTabs().filter(tab => tab.kind === 'scenario_lab').length === 1, 'workbench retained more than one Scenario Lab input');
t.capture('scenario-lab-cancelled-result-tiny-384x288');
