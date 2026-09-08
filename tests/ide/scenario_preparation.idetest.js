// Real canonical and scenario builds: unpublished candidates cannot reboot gameplay.
await t.waitForCart();
t.openLuaSource('title_screen.lua');
t.command('pause');
const runtime = t.runtime();
const sources = t.sourceState();
const originalMedia = sources.currentBlua32Media;
const originalRom = sources.cartridgeSlots[0].rom.bytes;
const originalInstalledSources = sources.cartridgeSlots[0].installedBlua32Sources;
const programModel = t.activeEditorDocument().model;
const programSource = programModel.buffer.getText() + '\n-- scenario preparation candidate\n';
t.replaceActiveCodeSource(programSource);
t.command('scenarioLab');
await t.frames(2);
const tab = t.activeWorkbenchTab();
const view = tab.view;
const index = view.testPane.rows.findIndex(row => row.kind === 'test'
	&& row.test.resource.path === 'tests/carts/nemesis_s/nemesis_s_cinematic_flow_assert.lua');
t.assert(index >= 0, 'actual cinematic test is missing');
const row = view.testPane.rows[index];
view.testPane.selectionIndex = index;
view.testPane.selectedNodeId = row.test.id;
t.openLuaSource(row.test.resource.path);
const model = t.activeEditorDocument().model;
const original = model.buffer.getText();
t.replaceActiveCodeSource(original + '\nend end\n');
t.command('scenarioLab');
const pausedAt = runtime.machine.scheduler.nowCycles;
t.command('scenarioLab.run');
for (let frame = 0; frame < 1000 && view.runActive; frame++) await t.frames(1);
const failed = view.resultService.runs[0];
t.assert(!view.runActive && failed.state === 'failed', 'invalid test did not report preparation failure');
t.assert(failed.items[0].failure.location.resource.path === row.test.resource.path,
	'preparation diagnostic lost its authored test source');
t.assert(runtime.machine.scheduler.nowCycles === pausedAt && sources.currentBlua32Media === originalMedia
	&& sources.cartridgeSlots[0].rom.bytes === originalRom
	&& sources.cartridgeSlots[0].installedBlua32Sources === originalInstalledSources,
	'failed test compilation published its rebuilt program or rebooted the old machine');
t.assert(programModel.dirty && sources.cartridgeBlua32MediaDirty[0],
	'failed preparation acknowledged the uninstalled canonical source');
t.openLuaSource(row.test.resource.path);
t.replaceActiveCodeSource(original);
t.command('scenarioLab');
t.command('scenarioLab.run');
t.command('scenarioLab.cancel');
for (let frame = 0; frame < 1000 && view.runActive; frame++) await t.frames(1);
t.assert(!view.runActive && view.resultService.runs[0].state === 'cancelled', 'queued launch was not cancelled');
t.assert(runtime.machine.scheduler.nowCycles === pausedAt && sources.currentBlua32Media === originalMedia
	&& sources.cartridgeSlots[0].rom.bytes === originalRom, 'cancelled preparation reset or published the old machine');
t.command('scenarioLab.run');
for (let frame = 0; frame < 4000 && view.runActive; frame++) await t.frames(1);
const passed = view.resultService.runs[0];
t.assert(!view.runActive && passed.state === 'passed' && passed.items[0].state === 'passed',
	'repaired cinematic did not execute its real assertions');
t.assert(sources.cartridgeSlots[0].installedBlua32Sources.get('title_screen') === programSource
	&& sources.cartridgeSlots[0].rom.bytes !== originalRom
	&& !sources.cartridgeBlua32MediaDirty[0], 'successful launch did not publish the accepted canonical source');
t.assert(t.runtime() === runtime && t.workbenchActive() && t.activeWorkbenchTab() === tab,
	'scenario completion did not restore the same runtime and originating input');
