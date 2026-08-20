await t.waitForCart();
await t.frames(20);

const findLogMessage = (firstIndex, predicate) => {
	for (let index = firstIndex; index < t.logMessageCount(); index += 1) {
		if (predicate(t.logMessage(index).message)) {
			return index;
		}
	}
	return -1;
};

const revisionSource = (record, revision) => record.base_src
	.replace(
		'\thot_resume_module_probe = hot_value.get()\n',
		"\thot_resume_module_probe = hot_value.get()\n\tprint('hot-resume-init')\n",
	)
	.replace(
		'\t-- hot-resume-edit-point\n',
		`\thot_resume_loop_count = hot_resume_loop_count + 1\n\thot_resume_entry_edit_probe = ${revision}\n\tif hot_resume_print_revision ~= ${revision} then\n\t\thot_resume_print_revision = ${revision}\n\t\tprint('hot-resume-revision-${revision}')\n\tend\n`,
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
const loopCountKey = cpu.stringPool.intern('hot_resume_loop_count');
cpu.setGlobalByKey(liveStateProbeKey, tableValueTag, NaN, liveMathTable);
const cartridge = sourceState.cartridgeSlots[cpu.activeCartridgeSlot()];
const entryRecord = cartridge.luaSources.path2lua['entry.lua'];
const valueRecord = cartridge.luaSources.path2lua['value.lua'];
const baseRecord = sourceState.systemLuaSources.path2lua['base.lua'];
const initPrintBreakpointLine = revisionSource(entryRecord, 2)
	.split("\tprint('hot-resume-init')")[0]
	.split('\n').length;
const loopCountBreakpointLine = revisionSource(entryRecord, 2)
	.split('\thot_resume_loop_count =')[0]
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

const firstRevisionLogStart = t.logMessageCount();
await installRevision(1);
cpu.setGlobalByKey(loopCountKey, numberValueTag, 0, null);
await t.frames(60);

t.assert(t.runtime() === runtime, 'first Hot Resume replaced the live runtime');
t.assert(runtime.machine.cpu === cpu, 'first Hot Resume replaced the live CPU');
t.assert(cpu.getGlobalByKey(liveStateProbeKey) === liveMathTable, 'first Hot Resume replaced a live heap object');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_entry_edit_probe')) === 1, 'first entry edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_module_probe')) === 1, 'first module edit did not execute through init');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_system_probe')) === 1, 'first system-ROM edit did not execute');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === 2, 'first Hot Resume did not rerun init exactly once');
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'first Hot Resume reran new_game');
t.assert(
	findLogMessage(firstRevisionLogStart, message => message === 'hot-resume-init') >= 0,
	'first Hot Resume print did not reach the host SystemOutputLog',
);
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
runtime.machine.memory.writeMappedU32LE(0x08010420, dataOnlySlot);
t.assert(
	runtime.machine.memory.cartridgeController.selectedSlot() === dataOnlySlot,
	'dual-cart setup did not select the data-only socket',
);
t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
await t.performHotResume();

t.assert(!t.debuggerStopped(), 'Hot Resume tooling task executed guest init outside the frame scheduler');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint,
	'Hot Resume tooling task executed init before the next machine frame',
);
await t.frames(1);
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

const stoppedInitFrameDepth = cpu.getFrameDepth();
await t.performHotResume();

t.assert(!t.debuggerStopped(), 'nested Hot Resume did not release the stopped init frame');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint + 1,
	'nested Hot Resume executed its init inside the tooling task',
);
await t.frames(1);
t.assert(t.debuggerStopped(), 'fresh init consumed the relocated stopped frame suppression');
t.assert(
	cpu.getFrameDepth() > stoppedInitFrameDepth,
	'nested Hot Resume did not stop in the fresh init frame above the relocated stop',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint + 2,
	'fresh init did not reach its own print breakpoint',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_print_call_count')) === printCountBeforeBreakpoint,
	'fresh init print executed before its breakpoint',
);

t.command('debugContinue');
await t.frames(60);

t.assert(!t.debuggerStopped(), 'relocated stopped init immediately retriggered its breakpoint');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountBeforeBreakpoint + 2,
	'continuing nested init breakpoints reran init',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_print_call_count')) === printCountBeforeBreakpoint + 2,
	'continuing nested init breakpoints did not execute both prints',
);
t.assert(cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_new_game_count')) === 1, 'no-op Hot Resume reran new_game');
t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);

t.toggleBreakpoint('entry.lua', loopCountBreakpointLine);
await t.frames(60);
t.assert(t.debuggerStopped(), 'cart did not reach the loop breakpoint before stopped Hot Resume');
const loopCountAtStoppedHotResume = cpu.getGlobalByKey(loopCountKey);
const initCountAtStoppedHotResume = cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count'));
await t.performHotResume();

t.assert(!t.debuggerStopped(), 'Hot Resume did not release the relocated debugger stop');
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountAtStoppedHotResume,
	'Hot Resume executed init inside the tooling task while resuming a debugger stop',
);
await t.frames(60);
t.assert(t.debuggerStopped(), 'cart did not return to the loop breakpoint after stopped Hot Resume');
t.assert(
	cpu.getGlobalByKey(loopCountKey) === loopCountAtStoppedHotResume + 1,
	'Hot Resume immediately retriggered the relocated breakpoint instead of executing its instruction once',
);
t.assert(
	cpu.getGlobalByKey(cpu.stringPool.intern('hot_resume_init_count')) === initCountAtStoppedHotResume + 1,
	'scheduler did not execute init exactly once while resuming a debugger stop',
);
t.toggleBreakpoint('entry.lua', loopCountBreakpointLine);
t.command('debugContinue');
await t.frames(20);

t.toggleBreakpoint('entry.lua', initPrintBreakpointLine);
await t.reboot();
await t.frames(60);

t.assert(t.debuggerStopped(), 'cold reboot did not stop at the init print breakpoint');
t.capture('hot-resume-reboot-init-breakpoint');
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: true, value: 1, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyZ', down: true, value: 1, timestamp: 0, pressId: 2 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: false, value: 0, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyZ', down: false, value: 0, timestamp: 0, pressId: 2 });
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

t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(revisionSource(entryRecord, 2).replace(
	"\tprint('hot-resume-init')\n",
	"\tprint('hot-resume-init')\n\thot_resume_module_probe()\n",
));
const faultLogStart = t.logMessageCount();
await t.performHotResume();

const faultSequenceAddress = 0x08010438;
let faultSequence = 0;
for (let frame = 0; frame < 1200 && faultSequence === 0; frame += 1) {
	await t.frames(1);
	faultSequence = rebootedRuntime.machine.memory.readMappedU32LE(faultSequenceAddress);
}
t.assert(faultSequence !== 0, 'faulting Hot Resume init did not reach the physical BIOS monitor');
await t.frames(15);
const CPU_STATUS_USER_MODE_CURRENT = 1 << 1;
const faultState = rebootedCpu.captureRuntimeState();
t.assert((faultState.statusWord & CPU_STATUS_USER_MODE_CURRENT) === 0, 'faulting Hot Resume init did not enter supervisor mode');
t.assert(rebootedCpu.isHaltedUntilIrq(), 'physical BIOS monitor did not halt for input after the Hot Resume fault');
const firmwareFaultLogIndex = findLogMessage(
	faultLogStart,
	message => message === 'BMSX BIOS MONITOR',
);
const toolingFaultLogIndex = findLogMessage(
	faultLogStart,
	message => message.startsWith('Error: Attempted to call a non-function value.'),
);
t.assert(firmwareFaultLogIndex >= 0, 'physical BIOS monitor output did not reach SystemOutputLog');
t.assert(
	toolingFaultLogIndex > firmwareFaultLogIndex,
	'tooling fault diagnostics were logged before physical BIOS monitor output',
);
t.capture('hot-resume-init-fault-terminal');

t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: true, value: 1, timestamp: 0, pressId: 3 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyZ', down: true, value: 1, timestamp: 0, pressId: 4 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: false, value: 0, timestamp: 0, pressId: 3 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyZ', down: false, value: 0, timestamp: 0, pressId: 4 });
await t.frames(12);
t.capture('hot-resume-init-fault-ide');

const faultedMedia = sourceState.currentBlua32Media;
const initCountAtFault = rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_init_count'));
const printCountAtFault = rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_print_call_count'));
const rebootedLoopCountKey = rebootedCpu.stringPool.intern('hot_resume_loop_count');
rebootedCpu.setGlobalByKey(rebootedLoopCountKey, numberValueTag, 0, null);
const loopCountAtFault = 0;
t.assert(rebootedRuntime.completionCallPending(), 'faulted init completion root is not physically pending');
t.openLuaSource('entry.lua');
t.replaceActiveCodeSource(revisionSource(entryRecord, 2));
await t.performHotResume();

t.assert(sourceState.currentBlua32Media === faultedMedia, 'supervisor Hot Resume installed media during phase one');
t.assert(!rebootedCpu.isUserMode(), 'supervisor Hot Resume left firmware during phase one');
t.assert(rebootedCpu.isHaltedUntilIrq(), 'supervisor Hot Resume ran BIOS monitor code during phase one');
t.assert(
	rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_init_count')) === initCountAtFault,
	'supervisor Hot Resume executed init during phase one',
);
t.assert(
	rebootedRuntime.machine.memory.readMappedU32LE(faultSequenceAddress) === faultSequence,
	'supervisor Hot Resume changed the physical fault sequence during phase one',
);
t.assert(rebootedRuntime.completionCallPending(), 'supervisor Hot Resume discarded the failed init before firmware exit');

let recovered = false;
for (let frame = 0; frame < 1200 && !recovered; frame += 1) {
	await t.frames(1);
	recovered = rebootedCpu.isUserMode()
		&& sourceState.currentBlua32Media !== faultedMedia
		&& rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_init_count')) === initCountAtFault + 1
		&& rebootedCpu.getGlobalByKey(rebootedLoopCountKey) > loopCountAtFault
		&& !rebootedRuntime.completionCallPending();
}

t.assert(recovered, 'fault repair did not resume the retained game without reboot');
t.assert(!t.debuggerStopped(), 'internal user-execution fence surfaced as a debugger stop');
t.assert(rebootedCpu.isUserMode(), 'fault repair did not return to user mode');
t.assert(sourceState.currentBlua32Media !== faultedMedia, 'fault repair did not install the fixed media');
t.assert(
	rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_init_count')) === initCountAtFault + 1,
	'fault repair did not execute fixed init exactly once',
);
t.assert(
	rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_print_call_count')) === printCountAtFault + 1,
	'fault repair did not send the fixed init print through the guest terminal path',
);
t.assert(
	rebootedCpu.getGlobalByKey(rebootedCpu.stringPool.intern('hot_resume_new_game_count')) === 1,
	'fault repair reran new_game',
);
t.assert(
	rebootedRuntime.machine.memory.readMappedU32LE(faultSequenceAddress) === faultSequence,
	'fault repair raised a second supervisor fault',
);
t.assert(!rebootedRuntime.completionCallPending(), 'fault repair left a completion root pending');
t.assert(
	rebootedCpu.getGlobalByKey(rebootedLoopCountKey) > loopCountAtFault,
	'fault repair did not continue the retained game loop',
);
