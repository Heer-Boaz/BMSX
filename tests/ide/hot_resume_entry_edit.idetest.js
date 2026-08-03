await t.waitForCart();
await t.frames(20);

const revisionSource = (record, revision) => record.base_src
	.replace(
		'\thot_resume_module_probe = hot_value.get()\n',
		"\thot_resume_module_probe = hot_value.get()\n\tprint('hot-resume-init')\n",
	)
	.replace(
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
	'print = function(...)\n',
	`print = function(...)\n\thot_resume_system_probe = ${revision}\n\thot_resume_print_call_count = (hot_resume_print_call_count or 0) + 1\n`,
);
const runtime = t.runtime();
const sourceState = t.sourceState();
const cpu = runtime.machine.cpu;
const systemAssetConsumerFunctionId = 'module:main/entry/local:init';
const initialSystemImage = sourceState.currentBlua32Media.system;
const initialSystemAssetConsumerIndex = initialSystemImage.symbols.metadata.functionIds.indexOf(
	systemAssetConsumerFunctionId,
);
t.assert(initialSystemAssetConsumerIndex >= 0, 'system asset consumer function is missing');
const initialSystemAssetConsumer = initialSystemImage.layout.functions[initialSystemAssetConsumerIndex];
const liveMathTable = cpu.getGlobalByKey(cpu.stringPool.intern('math'));
const liveStateProbeKey = cpu.stringPool.intern('__hot_resume_live_state_probe');
cpu.setGlobalByKey(liveStateProbeKey, tableValueTag, NaN, liveMathTable);
const cartridge = sourceState.cartridgeSlots[cpu.activeCartridgeSlot()];
const entryRecord = cartridge.luaSources.path2lua['entry.lua'];
const valueRecord = cartridge.luaSources.path2lua['value.lua'];
const baseRecord = sourceState.systemLuaSources.path2lua['base.lua'];
const initPrintBreakpointLine = revisionSource(entryRecord, 2)
	.split("\tprint('hot-resume-init')")[0]
	.split('\n').length;
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
await t.performHotResume();
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

t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(entryRecord.base_src.replace(
	'local function init<init>()',
	'local function init()',
));
await t.performHotResume();
await t.frames(60);

t.assert(sourceState.currentBlua32Media === originalMedia, 'init annotation removal replaced tooling media');
t.assert(cpu.getFrameDepth() === frameDepthBeforeRejectedEdit, 'init annotation removal changed frame depth');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeRejectedEdit,
	'init annotation removal executed guest code',
);

const installRevision = async (revision) => {
	t.openLuaSource('entry.lua');
	t.replaceActiveCodeSource(revisionSource(entryRecord, revision));
	t.openLuaSource('value.lua');
	t.replaceActiveCodeSource(moduleRevisionSource(valueRecord, revision));
	t.openLuaSource('base.lua');
	t.replaceActiveCodeSource(systemRevisionSource(baseRecord, revision));
	await t.performHotResume();
};

await installRevision(1);
await t.frames(60);

t.assert(t.runtime() === runtime, 'first Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'first Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'first Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 1, 'first entry edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 1, 'first module edit did not execute through init');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 1, 'first system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === 2, 'first Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'first Hot Resume reran new_game');
const firstSystemImage = sourceState.currentBlua32Media.system;
const firstSystemAssetConsumerIndex = firstSystemImage.symbols.metadata.functionIds.indexOf(
	systemAssetConsumerFunctionId,
);
t.assert(firstSystemAssetConsumerIndex >= 0, 'rebuilt system asset consumer function is missing');
const firstSystemAssetConsumer = firstSystemImage.layout.functions[firstSystemAssetConsumerIndex];
t.assert(
	firstSystemAssetConsumer.codeByteCount === initialSystemAssetConsumer.codeByteCount,
	'system Hot Resume degraded the asset consumer instruction stream',
);
t.assert(
	firstSystemAssetConsumer.maxStack === initialSystemAssetConsumer.maxStack,
	'system Hot Resume added asset-relocation temporaries to the runtime stack',
);

await installRevision(2);
await t.frames(60);

t.assert(t.runtime() === runtime, 'second Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'second Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'second Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 2, 'second consecutive entry edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 2, 'second consecutive module edit did not execute through init');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 2, 'second consecutive system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === 3, 'second Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'second Hot Resume reran new_game');

const initCountBeforeSystemOnlyEdit = cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count'));
cpu.setGlobalByKey(
	cpu.stringPool.intern('hot_resume_print_revision'),
	numberValueTag,
	-1,
	null,
);
t.openLuaSource('base.lua');
t.replaceActiveCodeSource(systemRevisionSource(baseRecord, 3));
await t.performHotResume();
await t.frames(60);

t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeSystemOnlyEdit,
	'system-only Hot Resume reran the mechanically relinked cartridge init',
);
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 3, 'system-only Hot Resume did not install live system code');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 2, 'system-only Hot Resume changed cartridge entry behavior');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 2, 'system-only Hot Resume changed cartridge module behavior');

const mediaBeforeNoOpRefresh = sourceState.currentBlua32Media;
const initCountBeforeBreakpoint = cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count'));
const printCountBeforeBreakpoint = cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_print_call_count'));
runtime.machine.memory.writeMappedU32LE(0x0801041c, dataOnlySlot);
t.assert(
	runtime.machine.memory.cartridgeController.selectedSlot() === dataOnlySlot,
	'dual-cart setup did not select the data-only socket',
);
t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
await t.performHotResume();

t.assert(t.debuggerStopped(), 'no-op Hot Resume did not stop at the init print breakpoint');
t.assert(sourceState.currentBlua32Media === mediaBeforeNoOpRefresh, 'no-op Hot Resume rebuilt tooling media');
t.assert(
	runtime.machine.memory.cartridgeController.selectedSlot() === dataOnlySlot,
	'no-op Hot Resume changed CART_SELECT',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint + 1,
	'init did not reach the print breakpoint',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_print_call_count')) === printCountBeforeBreakpoint,
	'print executed before its breakpoint',
);

t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
t.command('debugContinue');
await t.frames(60);

t.assert(!t.debuggerStopped(), 'debugger remained stopped after continuing init');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint + 1,
	'continuing the init breakpoint reran init',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_print_call_count')) === printCountBeforeBreakpoint + 1,
	'continuing the init breakpoint did not execute print',
);
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'no-op Hot Resume reran new_game');

t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
await t.reboot();
await t.frames(60);

t.assert(t.debuggerStopped(), 'cold reboot did not stop at the init print breakpoint');
t.capture('hot-resume-reboot-init-breakpoint');
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'F1', down: true, value: 1, timestamp: 0, pressId: 1 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'F1', down: false, value: 0, timestamp: 0, pressId: 1 });
await t.frames(2);
t.capture('hot-resume-reboot-terminal-font');
t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
t.command('debugContinue');
await t.waitForCart();
await t.frames(20);

const rebootedRuntime = t.runtime();
const rebootedCpu = rebootedRuntime.machine.cpu;
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_entry_edit_probe')) === 2, 'cold boot did not execute the second cartridge-ROM revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_module_probe')) === 2, 'cold boot did not execute the second module revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_system_probe')) === 3, 'cold boot did not execute the third system-ROM revision');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_init_count')) === 1, 'cold boot did not execute init exactly once');
t.assert(rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'cold boot did not execute new_game exactly once');
