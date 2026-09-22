// Test builds consume current workspace sources but never install into gameplay.
await t.waitForCart();
t.openLuaSource('title_screen.lua');
t.command('pause');
const runtime = t.runtime();
const sources = t.sourceState();
const originalMedia = sources.currentBlua32Media;
const originalRom = sources.cartridgeSlots[0].rom.bytes;
const originalInstalledSources = sources.cartridgeSlots[0].installedBlua32Sources;
const originalDirty = sources.cartridgeBlua32MediaDirty[0];
const programModel = t.activeEditorDocument().model;
const originalProgram = programModel.buffer.getText();
t.replaceActiveCodeSource(originalProgram + '\nend end\n');
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
const pausedAt = runtime.machine.scheduler.nowCycles;
t.command('scenarioLab.run');
for (let frame = 0; frame < 1000 && view.runActive; frame++) await t.frames(1);
const failed = view.resultService.runs[0];
t.assert(!view.runActive && failed.state === 'failed', 'invalid program did not report preparation failure');
t.assert(failed.items[0].failures[0].location.resource.path === 'title_screen.lua',
	'preparation diagnostic lost its authored source');
t.assert(runtime.machine.scheduler.nowCycles === pausedAt && sources.currentBlua32Media === originalMedia
	&& sources.cartridgeSlots[0].rom.bytes === originalRom
	&& sources.cartridgeSlots[0].installedBlua32Sources === originalInstalledSources,
	'failed compilation changed the authoring target');
t.assert(programModel.dirty && sources.cartridgeBlua32MediaDirty[0] === originalDirty, 'preparation acknowledged an uninstalled source');
t.openLuaSource('title_screen.lua');
t.replaceActiveCodeSource(originalProgram + '\n-- independent test build\n');
t.command('scenarioLab');
t.command('scenarioLab.run');
t.command('scenarioLab.cancel');
for (let frame = 0; frame < 1000 && view.runActive; frame++) await t.frames(1);
t.assert(!view.runActive && view.resultService.runs[0].state === 'cancelled', 'queued launch was not cancelled');
t.command('scenarioLab.run');
for (let frame = 0; frame < 8000 && view.runActive; frame++) await t.frames(1);
const passed = view.resultService.runs[0];
t.assert(!view.runActive && passed.state === 'passed', 'repaired cinematic did not execute its assertions: ' + JSON.stringify(passed.items.map(item => ({ state: item.state, failures: item.failures }))));
t.assert(runtime.machine.scheduler.nowCycles === pausedAt && sources.currentBlua32Media === originalMedia
	&& sources.cartridgeSlots[0].rom.bytes === originalRom
	&& sources.cartridgeSlots[0].installedBlua32Sources === originalInstalledSources,
	'successful test published media into the authoring target');
t.assert(programModel.dirty && sources.cartridgeBlua32MediaDirty[0] === originalDirty, 'successful test acknowledged uninstalled authoring changes');
t.assert(t.runtime() === runtime && t.workbenchActive() && t.activeWorkbenchTab() === tab,
	'test completion changed the originating workbench');
