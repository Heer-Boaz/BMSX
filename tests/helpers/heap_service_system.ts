import { type OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { readLE32 } from '../../machine/ts/common/endian';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../machine/ts/spec/blua32/image_format';
import { createTestSystemCpu, linkTestSystemBlua32, type TestBlua32Image } from './blua32';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { Thread } from '../../machine/ts/machine/cpu/thread';
import { ThreadField, ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { HEAP_SERVICE_REMARK_FAULTS_OFFSET, HEAP_SERVICE_REMARK_HEAD_OFFSET, HeapServiceRemarkHeadField } from '../../machine/ts/spec/bmsx/heap_service';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram, type SystemCompileOptions } from '../../toolchain/ts/lua/compiler';
import type { ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { allocateThreadRecordReference } from './thread_allocation_reference';

const testBiosUtilityModules = ['math/sin', 'string/float/decode', 'gpu/system_vram_region', 'tty/layout'];
const testSystemAssets = {
	path: 'bmsx/system_assets',
	source: `module<const>
rodata texture: word[3] = { 0xa0000000, 0x02d002c0, 0x00fc0140 }
return { bin_gx_system_texture_addr = texture }`,
};

type FixtureModule = ProgramModule & { source: string };

let heapServiceTestModules: readonly FixtureModule[] | undefined;
let biosUtilityTestModules: readonly FixtureModule[] | undefined;

export function loadHeapServiceTestModules(): readonly FixtureModule[] {
	return heapServiceTestModules ??= HEAP_SERVICE_MODULES.map(path => {
		const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
		return { path, source, chunk: parseLuaChunk(source, path).chunk };
	});
}

/** The other published BIOS slots retain their actual functions in paired ROM fixtures. */
export function loadTestBiosUtilityModules(): readonly FixtureModule[] {
	return biosUtilityTestModules ??= testBiosUtilityModules
		.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }))
		.concat(testSystemAssets)
		.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path).chunk }));
}

/** Compile an executable fixture with the System BIOS operation roster. */
export function compileTestSystemWithHeap(chunk: LuaChunk, modules: readonly ProgramModule[],
	options: SystemCompileOptions) {
	const fixturePaths = new Set(modules.map(module => module.path));
	const firmware = loadHeapServiceTestModules().filter(module => !fixturePaths.has(module.path));
	return compileLuaChunkToProgram(chunk, [...firmware, ...modules], {
		...options, preloadModules: [...HEAP_SERVICE_MODULES, ...(options.preloadModules ?? [])],
	});
}

export function compileHeapServiceSystem(entrySource: string, optLevel: OptimizationLevel,
	bootModules: readonly { path: string; source: string }[] = [], entryPath = 'test.lua') {
	const modules = [
		...loadTestBiosUtilityModules().filter(module => !bootModules.some(input => input.path === module.path)),
		...bootModules.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path).chunk })),
	];
	return compileTestSystemWithHeap(parseLuaChunk(entrySource, entryPath).chunk, modules,
		{ entrySource, optLevel, programDomain: 'system', preloadModules: bootModules.map(({ path }) => path) });
}

/** A hand-assembled entry in the same verified ROM as the real firmware. */
export function linkHeapServiceEntry(text: Uint8Array, maxStack: number, isVararg = false) {
	const compiled = compileHeapServiceSystem('halt_until_irq\n'.repeat(text.byteLength / INSTRUCTION_BYTES - 1), 0);
	const entry = compiled.program.protos[compiled.entryProtoIndex];
	assert.equal(entry.codeLen, text.byteLength);
	compiled.program.code.set(text, entry.entryPC);
	entry.maxStack = maxStack;
	entry.isVararg = isVararg;
	return linkTestSystemBlua32(compiled);
}

/** Resolve the actual fixed root from fixture linker symbols, not a CPU roster. */
export function residentFunctionAddress(linked: Pick<TestBlua32Image, 'image' | 'symbols'>, module: string, member: string): number {
	const index = linked.symbols.metadata.functionIds.findIndex(id => id.startsWith(`module:${module}/`) && id.endsWith(`|constant|${member}`));
	assert.ok(index >= 0, `linked resident function ${module}:${member}`);
	const record = linked.image.functions[index];
	assert.notEqual(readLE32(linked.image.bytes, record.address - linked.image.address + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT, 0);
	return record.address;
}

const fixtureFaultTexts = [
	'Attempted to get length of an unsupported value.',
	'Attempted to call a non-function value.',
	'Attempted to index field on a non-table value.',
	'Attempted to assign to a non-table value.',
	'Table index is nil.',
	'Metatable index chain too long.',
	'Attempted to iterate a non-table value.',
	'xpcall error handler must be a function.',
	'', // Explicit faults carry a Value, not a diagnostic string.
	'Out of memory.',
	'Invalid argument.',
	"invalid key to 'next'",
	'Table index is NaN.',
] as const;

/** Admit the native reference's initial heap on a fresh test CPU after raw reset. */
export function admitTestHeapServiceCpu(cpu: CPU, executionAddressSpace: ExecutionAddressSpace): void {
	const { memory, heapAllocator: arena, gc, luaHeap, stringPool } = cpu;
	const boot = executionAddressSpace.resolveSystemDomain();
	const management = arena.managementOffset(), floor = arena.floorOffset(boot.staticEnd);
	memory.bindDlmalloc(arena.allocatorStateOffset()).reset(floor, management);
	memory.setRamBusEnd(RAM_BASE + floor);
	luaHeap.setCollectionTarget(1024 * 1024);

	// These are the native reference's original permanent roots, in allocation order.
	const index = stringPool.intern('__index'), newIndex = stringPool.intern('__newindex');
	const length = stringPool.intern('__len'), mode = stringPool.intern('__mode');
	const error = stringPool.intern('error in error handling');
	const remark = management + HEAP_SERVICE_REMARK_HEAD_OFFSET, faults = management + HEAP_SERVICE_REMARK_FAULTS_OFFSET;
	memory.writeRamRecordWord(remark + HeapServiceRemarkHeadField.Mode, mode);
	memory.writeRamRecordPair(remark + HeapServiceRemarkHeadField.Index, index, newIndex);
	memory.writeRamRecordPair(remark + HeapServiceRemarkHeadField.Length, length, error);
	memory.writeRamRecordWord(remark + HeapServiceRemarkHeadField.FaultIds, RAM_BASE + faults);
	for (let reason = 0; reason < fixtureFaultTexts.length; ++reason) {
		const id = reason === LUA_FAULT_REASON_EXPLICIT_ERROR ? 0 : stringPool.intern(fixtureFaultTexts[reason]);
		memory.writeRamRecordWord(faults + 4 * reason, id);
	}

	const raw = cpu.activeThread, root = allocateThreadRecordReference(cpu, 0);
	const adopted = new Thread(gc);
	adopted.bindAddress(root);
	adopted.bindStack();
	adopted.status = ThreadStatus.Running;
	const end = raw.stackTop;
	const valueCapacity = Math.max(8, 1 << (32 - Math.clz32(end - 1)));
	adopted.reserveFrame(valueCapacity);
	const first = adopted.acquireFrame().controlOffset, source = raw.currentFrame!.controlOffset;
	memory.ramData().copyWithin(first, source, source + FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(first, FRAME_CONTROL_BYTES);
	adopted.stackTop = end;
	memory.writeRamRecordWord(root + ThreadField.FrameDepth, 1);

	cpu.replaceExecutionImages([boot]);
	const state = cpu.captureRuntimeState();
	state.rootThreadAddress = state.activeThreadAddress = state.completionThreadAddress = root;
	memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + ThreadField.FrameDepth, 0);
	cpu.restoreRuntimeState(state);
}

/** Create linked algorithm fixtures with independent native heap backing. */
export function createTestHeapServiceCpu(linked: Pick<TestBlua32Image, 'romBytes'>, backend?: CpuExecutionBackend) {
	const fixture = createTestSystemCpu(linked, backend);
	admitTestHeapServiceCpu(fixture.cpu, fixture.executionAddressSpace);
	return fixture;
}
