// End-to-end IDE test for the dedicated hot_resume_test fixture.

await t.waitForCart();
await t.frames(20);

const machineManager = globalThis.bmsx.machineManager;
const revisionSource = (record, revision) => record.base_src.replace(
	'\t-- hot-resume-edit-point\n',
	`\thot_resume_entry_edit_probe = ${revision}\n\tif hot_resume_print_revision ~= ${revision} then\n\t\thot_resume_print_revision = ${revision}\n\t\tprint('hot-resume-revision-${revision}')\n\tend\n`,
);
const moduleRevisionSource = (record, revision) => record.base_src.replace(
	'\t-- hot-resume-module-edit-point\n\treturn 0\n',
	`\treturn ${revision}\n`,
);
const systemRevisionSource = (record, revision) => record.base_src.replace(
	'function gx_gpu.clear_color(color)\n',
	`function gx_gpu.clear_color(color)\n\thot_resume_system_probe = ${revision}\n`,
);
const runtime = t.runtime();
const cpu = runtime.machine.cpu;
const mathTable = cpu.getGlobalByKey(runtime.internString('math'));
const liveStateProbeKey = runtime.internString('__hot_resume_live_state_probe');
cpu.setGlobalByKey(liveStateProbeKey, mathTable);
const systemProtoIndex = runtime.programMetadata.protoIds.indexOf('module:system/gx_gpu/module/decl:gx_gpu.clear_color');
const cartProtoIndex = runtime.programMetadata.protoIds.indexOf('module:entry/entry');
let systemResumePoints = runtime.programMetadata.resumePointsByProto[systemProtoIndex];
let cartResumePoints = runtime.programMetadata.resumePointsByProto[cartProtoIndex];
let systemResumePc = cpu.program.protos[systemProtoIndex].entryPC
	+ systemResumePoints[systemResumePoints.length - 1].wordOffset * 4;
let cartResumePc = cpu.program.protos[cartProtoIndex].entryPC + cartResumePoints[0].wordOffset * 4;
// Observe the complete relocation table at its real consumer so both rebuild stages
// must survive the production composition path.
const relocateActiveFrames = cpu.relocateActiveFrames;
let appliedPcRelocations = null;
cpu.relocateActiveFrames = (relocations) => {
	appliedPcRelocations = relocations;
	relocateActiveFrames.call(cpu, relocations);
};
const entryRecord = machineManager.sourceState.cartLuaSources.path2lua['entry.lua'];
const valueRecord = machineManager.sourceState.cartLuaSources.path2lua['value.lua'];
const gxGpuRecord = machineManager.sourceState.systemLuaSources.path2lua['system/gx_gpu.lua'];
t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(revisionSource(entryRecord, 1));
t.openLuaSource('value.lua');
t.replaceActiveCodeSource(moduleRevisionSource(valueRecord, 1));
t.openLuaSource('system/gx_gpu.lua');
t.replaceActiveCodeSource(systemRevisionSource(gxGpuRecord, 1));

t.performHotResume();
await t.frames(60);

t.assert(t.runtime() === runtime, 'hot resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'hot resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === mathTable, 'hot resume replaced a live heap object');
let relocatedSystemPc = appliedPcRelocations[systemResumePc / 4];
let relocatedCartPc = appliedPcRelocations[cartResumePc / 4];
let linkedProto = cpu.program.protos[systemProtoIndex];
t.assert(relocatedSystemPc >= linkedProto.entryPC && relocatedSystemPc < linkedProto.entryPC + linkedProto.codeLen, 'combined rebuild dropped the system program-counter relocation');
linkedProto = cpu.program.protos[cartProtoIndex];
t.assert(relocatedCartPc >= linkedProto.entryPC && relocatedCartPc < linkedProto.entryPC + linkedProto.codeLen, 'combined rebuild dropped the cart program-counter relocation');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_entry_edit_probe')) === 1, 'changed editor entry-loop code did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_module_probe')) === 1, 'changed editor module did not execute through init');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_system_probe')) === 1, 'combined system and cart rebuild did not execute changed system code');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_init_count')) === 2, 'hot resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_new_game_count')) === 1, 'hot resume reran new_game');

systemResumePoints = runtime.programMetadata.resumePointsByProto[systemProtoIndex];
cartResumePoints = runtime.programMetadata.resumePointsByProto[cartProtoIndex];
systemResumePc = cpu.program.protos[systemProtoIndex].entryPC
	+ systemResumePoints[systemResumePoints.length - 1].wordOffset * 4;
cartResumePc = cpu.program.protos[cartProtoIndex].entryPC + cartResumePoints[0].wordOffset * 4;
appliedPcRelocations = null;

t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(revisionSource(entryRecord, 2));
t.openLuaSource('value.lua');
t.replaceActiveCodeSource(moduleRevisionSource(valueRecord, 2));
t.openLuaSource('system/gx_gpu.lua');
t.replaceActiveCodeSource(systemRevisionSource(gxGpuRecord, 2));

t.performHotResume();
await t.frames(60);

t.assert(t.runtime() === runtime, 'second hot resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'second hot resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === mathTable, 'second hot resume replaced a live heap object');
relocatedSystemPc = appliedPcRelocations[systemResumePc / 4];
relocatedCartPc = appliedPcRelocations[cartResumePc / 4];
linkedProto = cpu.program.protos[systemProtoIndex];
t.assert(relocatedSystemPc >= linkedProto.entryPC && relocatedSystemPc < linkedProto.entryPC + linkedProto.codeLen, 'consecutive combined rebuild dropped the system program-counter relocation');
linkedProto = cpu.program.protos[cartProtoIndex];
t.assert(relocatedCartPc >= linkedProto.entryPC && relocatedCartPc < linkedProto.entryPC + linkedProto.codeLen, 'consecutive combined rebuild dropped the cart program-counter relocation');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_entry_edit_probe')) === 2, 'consecutive editor entry-loop edit did not execute');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_module_probe')) === 2, 'consecutive editor module edit did not execute through init');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_system_probe')) === 2, 'consecutive combined rebuild did not execute changed system code');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_init_count')) === 3, 'second consecutive hot resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(runtime.internString('hot_resume_new_game_count')) === 1, 'second consecutive hot resume reran new_game');
cpu.relocateActiveFrames = relocateActiveFrames;

await machineManager.rebootToBootRom();
await t.waitForCart();
await t.frames(20);

const rebootedRuntime = t.runtime();
const rebootedCpu = rebootedRuntime.machine.cpu;
t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_entry_edit_probe')) === 2, 'reboot did not retain the second consecutive editor-built program tail');
t.assert(rebootedCpu.getGlobalByKey(rebootedRuntime.internString('hot_resume_system_probe')) === 2, 'reboot did not retain the rebuilt system program tail');
