// End-to-end IDE test for the dedicated hot_resume_test fixture.

await t.waitForCart();
await t.frames(20);

const machineManager = globalThis.bmsx.machineManager;
const storage = machineManager.platform.storage;
const projectRoot = machineManager.sourceState.cartProjectRootPath;
const entryDirtyPath = `${projectRoot}/.bmsx/dirty/~entry.lua`;
const valueDirtyPath = `${projectRoot}/.bmsx/dirty/~value.lua`;
const entryStorageKey = `bmsx.workspace:${projectRoot}:${entryDirtyPath}`;
const valueStorageKey = `bmsx.workspace:${projectRoot}:${valueDirtyPath}`;
const revisionSource = (record, revision) => record.base_src.replace(
	'\t-- hot-resume-edit-point\n',
	`\thot_resume_entry_edit_probe = ${revision}\n\tif hot_resume_print_revision ~= ${revision} then\n\t\thot_resume_print_revision = ${revision}\n\t\tprint('hot-resume-revision-${revision}')\n\tend\n`,
);
const moduleRevisionSource = (record, revision) => record.base_src.replace(
	'\t-- hot-resume-module-edit-point\n\treturn 0\n',
	`\treturn ${revision}\n`,
);
const storeRevision = (storageKey, record, contents, revision) => storage.setItem(storageKey, JSON.stringify({
	contents,
	updatedAt: record.base_update_timestamp + revision * 1000000,
}));

try {
	const runtime = t.runtime();
	const cpu = runtime.machine.cpu;
	const mathTable = cpu.getGlobalByKey(runtime.internString('math'));
	const liveStateProbeKey = runtime.internString('__hot_resume_live_state_probe');
	cpu.setGlobalByKey(liveStateProbeKey, mathTable);
	const entryRecord = machineManager.sourceState.cartLuaSources.path2lua['entry.lua'];
	const valueRecord = machineManager.sourceState.cartLuaSources.path2lua['value.lua'];
	storeRevision(entryStorageKey, entryRecord, revisionSource(entryRecord, 1), 1);
	storeRevision(valueStorageKey, valueRecord, moduleRevisionSource(valueRecord, 1), 1);

	t.performHotResume();
	await t.frames(60);

	t.assert(t.runtime() === runtime, 'hot resume replaced the live runtime');
	t.assert(runtime.machine.cpu === cpu, 'hot resume replaced the live CPU');
	t.assert(cpu.getGlobalByKey(liveStateProbeKey) === mathTable, 'hot resume replaced a live heap object');
	t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_entry_edit_probe')) === 1, 'changed entry-loop code did not execute');
	t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_module_probe')) === 1, 'changed module closure did not execute through init');
	t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_init_count')) === 2, 'hot resume did not rerun init exactly once');
	t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_new_game_count')) === 1, 'hot resume reran new_game');

	await machineManager.rebootToBootRom();
	await t.waitForCart();
	await t.frames(20);

	const rebootedRuntime = t.runtime();
	const rebootedCpu = rebootedRuntime.machine.cpu;
	const rebootedMathTable = rebootedCpu.getGlobalByKey(rebootedRuntime.internString('math'));
	const rebootedStateProbeKey = rebootedRuntime.internString('__hot_resume_live_state_probe');
	t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_entry_edit_probe')) === 1, 'reboot did not install the first physical program-tail revision');
	rebootedCpu.setGlobalByKey(rebootedStateProbeKey, rebootedMathTable);
	const rebootedEntryRecord = machineManager.sourceState.cartLuaSources.path2lua['entry.lua'];
	const rebootedValueRecord = machineManager.sourceState.cartLuaSources.path2lua['value.lua'];
	storeRevision(entryStorageKey, rebootedEntryRecord, revisionSource(rebootedEntryRecord, 2), 2);
	storeRevision(valueStorageKey, rebootedValueRecord, moduleRevisionSource(rebootedValueRecord, 2), 2);

	t.performHotResume();
	await t.frames(60);

	t.assert(t.runtime() === rebootedRuntime, 'second hot resume replaced the rebooted runtime');
	t.assert(rebootedRuntime.machine.cpu === rebootedCpu, 'second hot resume replaced the rebooted CPU');
	t.assert(rebootedCpu.getGlobalByKey(rebootedStateProbeKey) === rebootedMathTable, 'second hot resume replaced a live heap object');
	t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_entry_edit_probe')) === 2, 'second changed entry-loop code did not execute');
	t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_module_probe')) === 2, 'second changed module closure did not execute through init');
	t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_init_count')) === 2, 'second hot resume did not rerun init exactly once');
	t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_new_game_count')) === 1, 'second hot resume reran new_game');
} finally {
	storage.removeItem(entryStorageKey);
	storage.removeItem(valueStorageKey);
}
