await t.waitForCart();
await t.frames(20);

const machineManager = globalThis.bmsx.machineManager;
const revisionSource = (record, revision) => record.base_src.replace(
	'\t-- hot-resume-edit-point\n',
	`\thot_resume_entry_edit_probe = ${revision}\n\tif hot_resume_print_revision ~= ${revision} then\n\t\thot_resume_print_revision = ${revision}\n\t\tprint('hot-resume-revision-${revision}')\n\tend\n`,
);
const moduleRevisionSource = (record, revision) => record.base_src
	.replace(
		'local get<const> = function()\n',
		`local inserted_before_get<const> = function()\n\treturn -${revision}\nend\n\nlocal get<const> = function()\n`,
	)
	.replace(
		'\t-- hot-resume-module-edit-point\n\treturn 0\n',
		`\treturn ${revision}\n`,
	)
	.replace(
		'\tget = get,\n',
		'\tget = get,\n\tinserted_before_get = inserted_before_get,\n',
	);
const systemRevisionSource = (record, revision) => record.base_src.replace(
	'function gx_gpu.clear_color(color)\n',
	`function gx_gpu.clear_color(color)\n\thot_resume_system_probe = ${revision}\n`,
);
const runtime = t.runtime();
const cpu = runtime.machine.cpu;
const liveMathTable = cpu.getGlobalByKey(runtime.internString('math'));
const liveStateProbeKey = runtime.internString('__hot_resume_live_state_probe');
cpu.setGlobalByKey(liveStateProbeKey, liveMathTable);
const cartridge = machineManager.sourceState.cartridgeSlots[cpu.activeCartridgeSlot()];
const entryRecord = cartridge.luaSources.path2lua['entry.lua'];
const valueRecord = cartridge.luaSources.path2lua['value.lua'];
const gxGpuRecord = machineManager.sourceState.systemLuaSources.path2lua['system/gx_gpu.lua'];
const initialSystemMediaRevision = runtime.machine.memory.systemRomRevision();
const initialCartMediaRevision = runtime.machine.memory.cartridgeController.romRevision(cpu.activeCartridgeSlot());
const dataOnlySlot = cpu.activeCartridgeSlot() === 0 ? 1 : 0;
const dataOnlyCartridge = machineManager.sourceState.cartridgeSlots[dataOnlySlot];
const initialDataOnlyMediaRevision = runtime.machine.memory.cartridgeController.romRevision(dataOnlySlot);
t.assert(dataOnlyCartridge !== null, 'second cartridge is not installed');
t.assert(dataOnlyCartridge.rom.header.blua32ImageOffset === 0, 'second cartridge unexpectedly contains executable BLua32');

const installRevision = (revision) => {
	t.openLuaSource('entry.lua');
	t.replaceActiveCodeSource(revisionSource(entryRecord, revision));
	t.openLuaSource('value.lua');
	t.replaceActiveCodeSource(moduleRevisionSource(valueRecord, revision));
	t.openLuaSource('system/gx_gpu.lua');
	t.replaceActiveCodeSource(systemRevisionSource(gxGpuRecord, revision));
	t.performHotResume();
};

installRevision(1);
await t.frames(60);

t.assert(t.runtime() === runtime, 'first Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'first Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'first Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_entry_edit_probe')) === 1, 'first entry edit did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_module_probe')) === 1, 'first module edit did not execute through init');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_system_probe')) === 1, 'first system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_init_count')) === 2, 'first Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_new_game_count')) === 1, 'first Hot Resume reran new_game');
t.assert(runtime.machine.memory.systemRomRevision() === initialSystemMediaRevision + 1, 'first system-ROM revision was not installed');
t.assert(runtime.machine.memory.cartridgeController.romRevision(cpu.activeCartridgeSlot()) === initialCartMediaRevision + 1, 'first cartridge-ROM revision was not installed');
t.assert(runtime.machine.memory.cartridgeController.romRevision(dataOnlySlot) === initialDataOnlyMediaRevision, 'first Hot Resume replaced the data-only cartridge');

installRevision(2);
await t.frames(60);

t.assert(t.runtime() === runtime, 'second Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'second Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'second Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_entry_edit_probe')) === 2, 'second consecutive entry edit did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_module_probe')) === 2, 'second consecutive module edit did not execute through init');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_system_probe')) === 2, 'second consecutive system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_init_count')) === 3, 'second Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_new_game_count')) === 1, 'second Hot Resume reran new_game');
t.assert(runtime.machine.memory.systemRomRevision() === initialSystemMediaRevision + 2, 'second system-ROM revision was not installed');
t.assert(runtime.machine.memory.cartridgeController.romRevision(cpu.activeCartridgeSlot()) === initialCartMediaRevision + 2, 'second cartridge-ROM revision was not installed');
t.assert(runtime.machine.memory.cartridgeController.romRevision(dataOnlySlot) === initialDataOnlyMediaRevision, 'second Hot Resume replaced the data-only cartridge');

await machineManager.rebootToBootRom();
await t.waitForCart();
await t.frames(20);

const rebootedRuntime = t.runtime();
const rebootedCpu = rebootedRuntime.machine.cpu;
t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_entry_edit_probe')) === 2, 'cold boot did not execute the second cartridge-ROM revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_module_probe')) === 2, 'cold boot did not execute the second module revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_system_probe')) === 2, 'cold boot did not execute the second system-ROM revision');
