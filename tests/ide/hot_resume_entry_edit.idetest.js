// Headless IDE test: dirty cart entry edits are compiled into the running program.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_entry_edit.idetest.js

await t.waitForCart();
await t.frames(20);

const runtime = t.runtime();
const record = runtime.cartLuaSources.path2lua['cart.lua'];
const probeSource = record.src.replace("\tupdate_world()", "\t__hot_resume_entry_edit_probe = 6789\n\tupdate_world()");
const dirtyPath = `${runtime.cartProjectRootPath}/.bmsx/dirty/~cart.lua`;
const storageKey = `bmsx.workspace:${runtime.cartProjectRootPath}:${dirtyPath}`;
runtime.storageService.setItem(storageKey, JSON.stringify({
	contents: probeSource,
	updatedAt: record.base_update_timestamp + 1000000,
}));

t.performHotResume();
await t.frames(60);

const marker = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_entry_edit_probe'));
runtime.storageService.removeItem(storageKey);
t.log(`marker=${marker}`);
t.assert(marker === 6789, `expected hot-resumed entry code to run, got ${marker}`);
