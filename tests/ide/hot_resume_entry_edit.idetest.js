// Headless IDE test: hot-resume reruns init-owned registrations without new_game.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_entry_edit.idetest.js

await t.waitForCart();
await t.frames(20);

const runtime = t.runtime();
const storage = globalThis.bmsx.machineManager.platform.storage;
const fontRecord = runtime.cartLuaSources.path2lua['pietious_font.lua'];
const cartRecord = runtime.cartLuaSources.path2lua['cart.lua'];
const lootDropRecord = runtime.cartLuaSources.path2lua['loot_drop.lua'];
const paperfoeRecord = runtime.cartLuaSources.path2lua['enemies/paperfoe.lua'];
const fontProbeSource = fontRecord.src.replace(
	"local register_fonts<const> = function()\n",
	"local register_fonts<const> = function()\n\t__hot_resume_init_probe = (__hot_resume_init_probe or 0) + 1\n",
);
const cartProbeSource = cartRecord.src.replace(
	"function new_game()\n",
	"function new_game()\n\t__hot_resume_new_game_probe = (__hot_resume_new_game_probe or 0) + 1\n",
);
const lootDropProbeSource = lootDropRecord.src.replace(
	"\t\ton = {\n",
	"\t\ton = {\n\t\t\t['__hot_resume_fsm_probe'] = function()\n\t\t\t\treturn 6789\n\t\t\tend,\n",
);
const paperfoeProbeSource = paperfoeRecord.src.replace(
	"\tmove_with_velocity(self)\n\treturn 'RUNNING'",
	"\treturn 'SUCCESS'",
);
const fontDirtyPath = `${runtime.cartProjectRootPath}/.bmsx/dirty/~pietious_font.lua`;
const cartDirtyPath = `${runtime.cartProjectRootPath}/.bmsx/dirty/~cart.lua`;
const lootDropDirtyPath = `${runtime.cartProjectRootPath}/.bmsx/dirty/~loot_drop.lua`;
const paperfoeDirtyPath = `${runtime.cartProjectRootPath}/.bmsx/dirty/enemies/~paperfoe.lua`;
const fontStorageKey = `bmsx.workspace:${runtime.cartProjectRootPath}:${fontDirtyPath}`;
const cartStorageKey = `bmsx.workspace:${runtime.cartProjectRootPath}:${cartDirtyPath}`;
const lootDropStorageKey = `bmsx.workspace:${runtime.cartProjectRootPath}:${lootDropDirtyPath}`;
const paperfoeStorageKey = `bmsx.workspace:${runtime.cartProjectRootPath}:${paperfoeDirtyPath}`;
storage.setItem(fontStorageKey, JSON.stringify({
	contents: fontProbeSource,
	updatedAt: fontRecord.base_update_timestamp + 1000000,
}));
storage.setItem(cartStorageKey, JSON.stringify({
	contents: cartProbeSource,
	updatedAt: cartRecord.base_update_timestamp + 1000000,
}));
storage.setItem(lootDropStorageKey, JSON.stringify({
	contents: lootDropProbeSource,
	updatedAt: lootDropRecord.base_update_timestamp + 1000000,
}));
storage.setItem(paperfoeStorageKey, JSON.stringify({
	contents: paperfoeProbeSource,
	updatedAt: paperfoeRecord.base_update_timestamp + 1000000,
}));
runtime.machine.cpu.setGlobalByKey(runtime.internString('__hot_resume_new_game_probe'), 0);

const evaluateFsmProbe = () => t.evaluateLua(`
	local fsmlibrary<const> = require('cartlib/fsm/library')
	local definition<const> = fsmlibrary.get('loot_drop')
	local handler<const> = definition.on['__hot_resume_fsm_probe']
	return handler()
`)[0];
const evaluateBtProbe = () => t.evaluateLua(`
	local behaviourtree<const> = require('cartlib/behaviourtree')
	return behaviourtree.instantiate('enemy_paperfoe'):tick({}, {})
`)[0];

try {
	t.performHotResume();
	await t.frames(60);

	const initMarkerAfterFirstResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_init_probe'));
	const newGameMarkerAfterFirstResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_new_game_probe'));
	const fsmProbeAfterFirstResume = evaluateFsmProbe();
	const btProbeAfterFirstResume = evaluateBtProbe();
	t.log(`after_first_resume init=${initMarkerAfterFirstResume} new_game=${newGameMarkerAfterFirstResume} fsm=${fsmProbeAfterFirstResume} bt=${btProbeAfterFirstResume}`);
	t.assert(initMarkerAfterFirstResume === 1, `expected first hot-resume to run init once, got ${initMarkerAfterFirstResume}`);
	t.assert(newGameMarkerAfterFirstResume === 0, `expected first hot-resume not to run new_game, got ${newGameMarkerAfterFirstResume}`);
	t.assert(fsmProbeAfterFirstResume === 6789, `expected first hot-resume to install changed FSM handler, got ${fsmProbeAfterFirstResume}`);
	t.assert(btProbeAfterFirstResume === 'SUCCESS', `expected first hot-resume to activate changed behaviour tree handler, got ${btProbeAfterFirstResume}`);

	t.performHotResume();
	await t.frames(60);

	const initMarkerAfterSecondResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_init_probe'));
	const newGameMarkerAfterSecondResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_new_game_probe'));
	const fsmProbeAfterSecondResume = evaluateFsmProbe();
	const btProbeAfterSecondResume = evaluateBtProbe();
	t.log(`after_second_resume init=${initMarkerAfterSecondResume} new_game=${newGameMarkerAfterSecondResume} fsm=${fsmProbeAfterSecondResume} bt=${btProbeAfterSecondResume}`);
	t.assert(initMarkerAfterSecondResume === 2, `expected second hot-resume to run init again, got ${initMarkerAfterSecondResume}`);
	t.assert(newGameMarkerAfterSecondResume === 0, `expected second hot-resume not to run new_game, got ${newGameMarkerAfterSecondResume}`);
	t.assert(fsmProbeAfterSecondResume === 6789, `expected second hot-resume to keep changed FSM handler active, got ${fsmProbeAfterSecondResume}`);
	t.assert(btProbeAfterSecondResume === 'SUCCESS', `expected second hot-resume to keep changed behaviour tree handler active, got ${btProbeAfterSecondResume}`);
} finally {
	storage.removeItem(fontStorageKey);
	storage.removeItem(cartStorageKey);
	storage.removeItem(lootDropStorageKey);
	storage.removeItem(paperfoeStorageKey);
}
