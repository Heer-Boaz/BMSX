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
const sources = t.sourceState();
const canonicalMedia = sources.currentBlua32Media;
const canonicalCartridge = sources.cartridgeSlots[0].rom;

t.openLuaSource('cart.lua');
await t.frames(2);
t.command('scenarioLab');
await t.frames(2);
const labTab = t.activeWorkbenchTab();
t.assert(labTab.kind === 'scenario_lab', 'Scenario Lab command did not open its workbench input');
const view = labTab.view;
const testPane = view.testPane;
const resultPane = view.resultPane;
const testRowIndex = testPane.rows.findIndex(row =>
	row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/pietious/pietious_spyglass_input_assert.lua');
t.assert(testRowIndex >= 0, 'packaged Pietious ActionEffect scenario is missing');
const testRowY = testPane.layout.contentTop
	+ (testRowIndex - testPane.scroll) * view.layout.rowHeight
	+ 1;
await clickPointer(testPane.layout.contentLeft + 40, testRowY, 1);
await releasePointer(1);
t.assert(testPane.selectionIndex === testRowIndex,
`pointer did not select the Pietious ActionEffect scenario: selected=${testPane.selectionIndex} target=${testRowIndex} y=${testRowY} scroll=${testPane.scroll} top=${testPane.layout.contentTop} bottom=${testPane.layout.contentBottom} row=${view.layout.rowHeight}`);

t.command('scenarioLab.run');
await t.frames(1);
t.assert(view.runActive, 'Scenario Lab did not start the Pietious ActionEffect scenario');
await waitForRunToFinish(view, 1200);
await t.frames(2);

t.assert(t.runtime() === runtime, 'Scenario Lab replaced the live Pietious runtime');
t.assert(sources.currentBlua32Media === canonicalMedia, 'Scenario Lab did not restore Pietious tooling media');
t.assert(sources.cartridgeSlots[0].rom === canonicalCartridge, 'Scenario Lab replaced the canonical Pietious cartridge');
const result = resultPane.rows[0].result;
t.assert(result.state === 'passed', 'Pietious ActionEffect scenario did not pass');
const trace = result.actionEffectTrace;
t.assert(trace !== null, 'Pietious scenario did not bind its ActionEffect recorder');
t.assert(trace.executionDomain === 0
	&& trace.ownerId === 'pietolon'
	&& trace.ownerDefinitionId === 'player',
'Pietious ActionEffect trace selected the wrong concrete component owner');
t.assert(trace.facts.length === 1, 'Pietious input published an unexpected fact count');
const trigger = trace.facts.at(0);
t.assert(trigger.kind === 'trigger'
	&& trigger.effectId === 'spyglass'
	&& trigger.outcome === 'custom_gate',
'Pietious ActionEffect trace lost the direct custom-gate outcome');
t.assert(resultPane.rows.some(row => row.kind === 'actioneffect_fact' && row.fact === trigger),
'Scenario Lab did not project the Pietious ActionEffect outcome');
t.capture('scenario-lab-pietious-actioneffect-tiny-384x288');
