// Rebuilt Node Studio composition, using the same queued Reboot command as the GUI.
// Run: npm run ide:test -- hot_resume_test tests/ide/boot_operations.idetest.js
await t.waitForCart();
await t.frames(20);
const runtime = t.runtime();
const sources = t.sourceState();
const cart = sources.cartridgeSlots[0];
const source = cart.luaSources.path2lua['entry.lua'].base_src;
t.openLuaSource('entry.lua');
const model = t.activeEditorDocument().model;
const media = sources.currentBlua32Media;
const cycles = runtime.machine.scheduler.currentNowCycles();
t.replaceActiveCodeSource(source + '\nend end\n');
const rejected = await t.reboot().completion;
t.assert(rejected.status === 'rejected' && !rejected.installed && !rejected.reset, 'build rejection has no reset effects');
t.assert(sources.currentBlua32Media === media, 'rejected source did not replace installed media');
t.assert(runtime.machine.scheduler.currentNowCycles() === cycles, 'rejection preserved the paused physical execution');

t.replaceActiveCodeSource(source + '\n-- superseded node reboot\n');
const first = t.reboot();
const captured = source + '\n-- captured node reboot\n';
t.replaceActiveCodeSource(captured);
const second = t.reboot();
t.replaceActiveCodeSource(captured + '-- later typing\n');
const cancelled = await first.completion;
t.assert(cancelled.status === 'cancelled' && cancelled.reason === 'superseded', 'a newer Reboot retires queued preparation');
const reset = await second.completion;
t.assert(reset.status === 'reset' && reset.installed && reset.reset, 'the accepted source installs and resets');
t.assert(runtime.machine.scheduler.currentNowCycles() === 0, 'reset acknowledgement precedes guest execution');
t.assert(cart.installedBlua32Sources.get('entry') === captured, 'Reboot installs the admitted revision, not later typing');
t.assert(model.dirty, 'Reboot did not save the source');
await t.waitForCart();
await t.frames(20);
t.assert(runtime.machine.cpu.isCartridgeExecutionActive(), 'accepted source actually executes through BIOS');
