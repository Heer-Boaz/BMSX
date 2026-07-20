// Headless IDE test: hot-resume reruns init-owned registrations without new_game.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_entry_edit.idetest.js

await t.waitForCart();
await t.frames(20);

const runtime = t.runtime();
const cpu = runtime.machine.cpu;
const liveMathTable = cpu.getGlobalByKey(runtime.internString('math'));
const liveStateProbeKey = runtime.internString('__hot_resume_live_state_probe');
cpu.setGlobalByKey(liveStateProbeKey, liveMathTable);
const machineManager = globalThis.bmsx.machineManager;
const storage = machineManager.platform.storage;
const sources = machineManager.sourceState;
const fontRecord = sources.cartLuaSources.path2lua['pietious_font.lua'];
const cartRecord = sources.cartLuaSources.path2lua['cart.lua'];
const lootDropRecord = sources.cartLuaSources.path2lua['loot_drop.lua'];
const paperfoeRecord = sources.cartLuaSources.path2lua['enemies/paperfoe.lua'];
const mathRecord = sources.systemLuaSources.path2lua['bios/math.lua'];
const fontProbeSource = fontRecord.src.replace(
	"local register_fonts<const> = function()\n",
	"local register_fonts<const> = function()\n\t__hot_resume_init_probe = (__hot_resume_init_probe or 0) + 1\n",
);
const cartProbeSource = cartRecord.src.replace(
	"function new_game()\n",
	"function new_game()\n\t__hot_resume_new_game_probe = (__hot_resume_new_game_probe or 0) + 1\n",
).replace(
	"\tinit_epoch = init_epoch + 1\n",
	`\tlocal fsmlibrary<const> = require('cartlib/fsm/library')
\tlocal definition<const> = fsmlibrary.get('loot_drop')
\t__hot_resume_fsm_probe_result = definition.on['__hot_resume_fsm_probe']()
\tlocal behaviourtree<const> = require('cartlib/behaviourtree')
\t__hot_resume_bt_probe_result = behaviourtree.instantiate('enemy_paperfoe'):tick({}, {}) == 'SUCCESS'
\tif __hot_resume_rng_probe == nil then
\t\tmath.randomseed(123)
\tend
\t__hot_resume_rng_probe = math.random()
\tinit_epoch = init_epoch + 1
`,
);
const lootDropProbeSource = lootDropRecord.src.replace(
	"\t\ton = {\n",
	"\t\ton = {\n\t\t\t['__hot_resume_fsm_probe'] = function()\n\t\t\t\treturn 6789\n\t\t\tend,\n",
);
const paperfoeProbeSource = paperfoeRecord.src.replace(
	"\tmove_with_velocity(self)\n\treturn 'RUNNING'",
	"\treturn 'SUCCESS'",
);
const cartProjectRootPath = sources.cartProjectRootPath;
const fontDirtyPath = `${cartProjectRootPath}/.bmsx/dirty/~pietious_font.lua`;
const cartDirtyPath = `${cartProjectRootPath}/.bmsx/dirty/~cart.lua`;
const lootDropDirtyPath = `${cartProjectRootPath}/.bmsx/dirty/~loot_drop.lua`;
const paperfoeDirtyPath = `${cartProjectRootPath}/.bmsx/dirty/enemies/~paperfoe.lua`;
const mathDirtyPath = `${sources.systemProjectRootPath}/.bmsx/dirty/bios/~math.lua`;
const fontStorageKey = `bmsx.workspace:${cartProjectRootPath}:${fontDirtyPath}`;
const cartStorageKey = `bmsx.workspace:${cartProjectRootPath}:${cartDirtyPath}`;
const lootDropStorageKey = `bmsx.workspace:${cartProjectRootPath}:${lootDropDirtyPath}`;
const paperfoeStorageKey = `bmsx.workspace:${cartProjectRootPath}:${paperfoeDirtyPath}`;
const mathStorageKey = `bmsx.workspace:${sources.systemProjectRootPath}:${mathDirtyPath}`;
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

const evaluateFsmProbe = () => runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_fsm_probe_result'));
const evaluateBtProbe = () => runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_bt_probe_result'));
const assertLiveRuntimeState = (phase) => {
	t.assert(t.runtime() === runtime, `${phase} replaced the live runtime`);
	t.assert(runtime.machine.cpu === cpu, `${phase} replaced the live CPU`);
	t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, `${phase} replaced the live Lua heap object`);
	t.assert(cpu.getGlobalByKey(runtime.internString('math')) === liveMathTable, `${phase} rebuilt the live math module table`);
};

try {
	t.performHotResume();
	await t.frames(60);

	const initMarkerAfterFirstResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_init_probe'));
	const newGameMarkerAfterFirstResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_new_game_probe'));
	const fsmProbeAfterFirstResume = evaluateFsmProbe();
	const btProbeAfterFirstResume = evaluateBtProbe();
	const rngProbeAfterFirstResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_rng_probe'));
	t.log(`after_first_resume init=${initMarkerAfterFirstResume} new_game=${newGameMarkerAfterFirstResume} fsm=${fsmProbeAfterFirstResume} bt=${btProbeAfterFirstResume} rng=${rngProbeAfterFirstResume}`);
	assertLiveRuntimeState('first hot-resume');
	t.assert(initMarkerAfterFirstResume === 1, `expected first hot-resume to run init once, got ${initMarkerAfterFirstResume}`);
	t.assert(newGameMarkerAfterFirstResume === 0, `expected first hot-resume not to run new_game, got ${newGameMarkerAfterFirstResume}`);
	t.assert(fsmProbeAfterFirstResume === 6789, `expected first hot-resume to install changed FSM handler, got ${fsmProbeAfterFirstResume}`);
	t.assert(btProbeAfterFirstResume === true, `expected first hot-resume to activate changed behaviour tree handler, got ${btProbeAfterFirstResume}`);
	t.assert(rngProbeAfterFirstResume === 1218640798 / 4294967296, `expected first hot-resume RNG value, got ${rngProbeAfterFirstResume}`);

	storage.setItem(mathStorageKey, JSON.stringify({
		contents: `${mathRecord.src}\n-- force a physical firmware-tail rebuild\n`,
		updatedAt: mathRecord.base_update_timestamp + 1000000,
	}));
	t.performHotResume();
	await t.frames(60);

	const initMarkerAfterSecondResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_init_probe'));
	const newGameMarkerAfterSecondResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_new_game_probe'));
	const fsmProbeAfterSecondResume = evaluateFsmProbe();
	const btProbeAfterSecondResume = evaluateBtProbe();
	const rngProbeAfterSecondResume = runtime.machine.cpu.getGlobalByKey(runtime.internString('__hot_resume_rng_probe'));
	t.log(`after_second_resume init=${initMarkerAfterSecondResume} new_game=${newGameMarkerAfterSecondResume} fsm=${fsmProbeAfterSecondResume} bt=${btProbeAfterSecondResume} rng=${rngProbeAfterSecondResume}`);
	assertLiveRuntimeState('second hot-resume');
	t.assert(initMarkerAfterSecondResume === 2, `expected second hot-resume to run init again, got ${initMarkerAfterSecondResume}`);
	t.assert(newGameMarkerAfterSecondResume === 0, `expected second hot-resume not to run new_game, got ${newGameMarkerAfterSecondResume}`);
	t.assert(fsmProbeAfterSecondResume === 6789, `expected second hot-resume to keep changed FSM handler active, got ${fsmProbeAfterSecondResume}`);
	t.assert(btProbeAfterSecondResume === true, `expected second hot-resume to keep changed behaviour tree handler active, got ${btProbeAfterSecondResume}`);
	t.assert(rngProbeAfterSecondResume === 1868869221 / 4294967296, `expected second hot-resume to preserve RNG RAM state, got ${rngProbeAfterSecondResume}`);
} finally {
	storage.removeItem(fontStorageKey);
	storage.removeItem(cartStorageKey);
	storage.removeItem(lootDropStorageKey);
	storage.removeItem(paperfoeStorageKey);
	storage.removeItem(mathStorageKey);
}
