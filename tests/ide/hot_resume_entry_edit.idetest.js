await t.waitForCart();
await t.frames(20);

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
const sourceState = t.sourceState();
const cpu = runtime.machine.cpu;
const liveMathTable = cpu.getGlobalByKey(cpu.stringPool.intern('math'));
const liveStateProbeKey = cpu.stringPool.intern('__hot_resume_live_state_probe');
cpu.setGlobalByKey(liveStateProbeKey, tableValueTag, NaN, liveMathTable);
const cartridge = sourceState.cartridgeSlots[cpu.activeCartridgeSlot()];
const entryRecord = cartridge.luaSources.path2lua['entry.lua'];
const valueRecord = cartridge.luaSources.path2lua['value.lua'];
const gxGpuRecord = sourceState.systemLuaSources.path2lua['bios/gx_gpu.lua'];
const dataOnlySlot = cpu.activeCartridgeSlot() === 0 ? 1 : 0;
const dataOnlyCartridge = sourceState.cartridgeSlots[dataOnlySlot];
t.assert(dataOnlyCartridge !== null, 'second cartridge is not installed');
t.assert(dataOnlyCartridge.rom.header.blua32ImageOffset === 0, 'second cartridge unexpectedly contains executable BLua32');

const originalMedia = sourceState.currentBlua32Media;
const frameDepthBeforeRejectedEdit = cpu.getFrameDepth();
const frameWordsBeforeRejectedEdit = new Uint32Array(frameDepthBeforeRejectedEdit * 3);
for (let frameIndex = 0; frameIndex < frameDepthBeforeRejectedEdit; frameIndex += 1) {
	const wordOffset = frameIndex * 3;
	frameWordsBeforeRejectedEdit[wordOffset] = cpu.readFrameFunctionAddress(frameIndex);
	frameWordsBeforeRejectedEdit[wordOffset + 1] = cpu.readFramePc(frameIndex);
	frameWordsBeforeRejectedEdit[wordOffset + 2] = cpu.readFrameCallSitePc(frameIndex);
}
const lastExecutionDomainBeforeRejectedEdit = cpu.readLastExecutionDomain();
const lastPcBeforeRejectedEdit = cpu.lastPc;
const initCountBeforeRejectedEdit = cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count'));
t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(entryRecord.base_src.replace(
	'\trepeat\n\t\thalt_until_irq\n\tuntil vblank_count ~= 0\n\tvblank_count = vblank_count - 1\n',
	'\tvblank_count = 0\n',
));
t.performHotResume();
await t.frames(60);

t.assert(sourceState.currentBlua32Media === originalMedia, 'rejected edit replaced tooling media');
t.assert(cpu.getFrameDepth() === frameDepthBeforeRejectedEdit, 'rejected edit changed frame depth');
for (let frameIndex = 0; frameIndex < frameDepthBeforeRejectedEdit; frameIndex += 1) {
	const wordOffset = frameIndex * 3;
	t.assert(
		cpu.readFrameFunctionAddress(frameIndex) === frameWordsBeforeRejectedEdit[wordOffset]
			&& cpu.readFramePc(frameIndex) === frameWordsBeforeRejectedEdit[wordOffset + 1]
			&& cpu.readFrameCallSitePc(frameIndex) === frameWordsBeforeRejectedEdit[wordOffset + 2],
		`rejected edit changed frame ${frameIndex}`,
	);
}
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeRejectedEdit,
	'rejected edit reran init',
);
t.assert(
	cpu.readLastExecutionDomain() === lastExecutionDomainBeforeRejectedEdit
		&& cpu.lastPc === lastPcBeforeRejectedEdit,
	'rejected edit changed the last-execution latch',
);

const installRevision = (revision) => {
	t.openLuaSource('entry.lua');
	t.replaceActiveCodeSource(revisionSource(entryRecord, revision));
	t.openLuaSource('value.lua');
	t.replaceActiveCodeSource(moduleRevisionSource(valueRecord, revision));
	t.openLuaSource('bios/gx_gpu.lua');
	t.replaceActiveCodeSource(systemRevisionSource(gxGpuRecord, revision));
	t.performHotResume();
};

installRevision(1);
await t.frames(60);

t.assert(t.runtime() === runtime, 'first Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'first Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'first Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 1, 'first entry edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 1, 'first module edit did not execute through init');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 1, 'first system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === 2, 'first Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'first Hot Resume reran new_game');

installRevision(2);
await t.frames(60);

t.assert(t.runtime() === runtime, 'second Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'second Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'second Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 2, 'second consecutive entry edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 2, 'second consecutive module edit did not execute through init');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 2, 'second consecutive system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === 3, 'second Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'second Hot Resume reran new_game');

await t.reboot();
await t.waitForCart();
await t.frames(20);

const rebootedRuntime = t.runtime();
const rebootedCpu = rebootedRuntime.machine.cpu;
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_entry_edit_probe')) === 2, 'cold boot did not execute the second cartridge-ROM revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_module_probe')) === 2, 'cold boot did not execute the second module revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_system_probe')) === 2, 'cold boot did not execute the second system-ROM revision');
