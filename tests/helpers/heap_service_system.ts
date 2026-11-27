import { type OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { createTestSystemCpu, linkTestSystemBlua32, type TestBlua32Image } from './blua32';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { readLE32 } from '../../machine/ts/common/endian';
import type { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import type { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { Thread } from '../../machine/ts/machine/cpu/thread';
import { ThreadField, ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../machine/ts/spec/blua32/cop0';
import { GC_DIAGNOSTIC_OFFSET, GcDiagnosticField } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_DIAGNOSTIC_FAULTS_OFFSET, storeImageStringBinding } from './firmware_heap_layout';
import { EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_GLOBAL_NAME_ADDRESS_OFFSET, BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_CONSTANT_COUNT_OFFSET, BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_HEADER_SIZE,
	BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET, BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET,
	BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, Blua32ConstantTag,
} from '../../machine/ts/spec/blua32/image_format';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram, type SystemCompileOptions } from '../../toolchain/ts/lua/compiler';
import type { ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import { SYSTEM_KERNEL_MODULES } from '../../toolchain/ts/rompack/system';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import { allocateThreadRecordReference, reserveThreadFrameReference } from './thread_allocation_reference';

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
	return heapServiceTestModules ??= [...SYSTEM_KERNEL_MODULES, 'string/from_bytes'].map(path => {
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

/** Compile an executable fixture with the linked System runtime. */
export function compileTestSystemWithHeap(chunk: LuaChunk, modules: readonly ProgramModule[],
	options: SystemCompileOptions) {
	const fixturePaths = new Set(modules.map(module => module.path));
	const firmware = loadHeapServiceTestModules().filter(module => !fixturePaths.has(module.path));
	return compileLuaChunkToProgram(chunk, [...firmware, ...modules], {
		...options, preloadModules: [...SYSTEM_KERNEL_MODULES, ...(options.preloadModules ?? [])],
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
	const remark = management + GC_DIAGNOSTIC_OFFSET, faults = management + GC_DIAGNOSTIC_FAULTS_OFFSET;
	memory.writeRamRecordWord(remark + GcDiagnosticField.Mode, mode);
	memory.writeRamRecordPair(remark + GcDiagnosticField.Index, index, newIndex);
	memory.writeRamRecordPair(remark + GcDiagnosticField.Length, length, error);
	memory.writeRamRecordWord(remark + GcDiagnosticField.FaultIds, RAM_BASE + faults);
	for (let reason = 0; reason < fixtureFaultTexts.length; ++reason) {
		const id = reason === LUA_FAULT_REASON_EXPLICIT_ERROR ? 0 : stringPool.intern(fixtureFaultTexts[reason]);
		memory.writeRamRecordWord(faults + 4 * reason, id);
	}

	const raw = cpu.activeThread, root = allocateThreadRecordReference(cpu, 0);
	const adopted = new Thread(memory);
	adopted.bindAddress(root);
	adopted.bindStack();
	adopted.status = ThreadStatus.Running;
	const end = raw.stackTop;
	const valueCapacity = Math.max(8, 1 << (32 - Math.clz32(end - 1)));
	reserveThreadFrameReference(cpu, adopted, valueCapacity);
	const first = adopted.acquireFrame().controlOffset, source = raw.currentFrame!.controlOffset;
	memory.ramData().copyWithin(first, source, source + FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(first, FRAME_CONTROL_BYTES);
	adopted.stackTop = end;
	memory.writeRamRecordWord(root + ThreadField.FrameDepth, 1);

	// Raw instruction fixtures do not run BIOS binding code. Publish their
	// actual operand backing here using the independent native reference.
	const domain = SYSTEM_EXECUTION_DOMAIN_ID;
	const view = { bytes: new Uint8Array(0), byteOffset: 0 };
	executionAddressSpace.bindReadOnlyView(domain, boot.imageAddress, BLUA32_IMAGE_HEADER_SIZE, view);
	const header = view.bytes, h = view.byteOffset;
	const globalCount = readLE32(header, h + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET);
	const systemCount = readLE32(header, h + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET);
	const constantCount = readLE32(header, h + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET);
	if (constantCount !== 0) executionAddressSpace.bindReadOnlyView(domain,
		readLE32(header, h + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET), constantCount * BLUA32_CONSTANT_RECORD_SIZE, view);
	const constants = view.bytes, c = view.byteOffset;
	let stringCount = 0;
	for (let slot = 0; slot < constantCount; ++slot)
		stringCount += +(readLE32(constants, c + slot * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET) === Blua32ConstantTag.String);
	const bytes = 4 * (globalCount + systemCount + stringCount);
	stringPool.activateRomTable(domain, readLE32(header, h + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
		readLE32(header, h + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET));
	if (bytes !== 0) {
		const base = luaHeap.allocateRecord(bytes, false, 0, 0);
		let output = base;
		for (const [count, tableOffset, bank] of [
			[globalCount, BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, cpu['globalBank']],
			[systemCount, BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET, cpu['systemGlobalBank']],
		] as const) {
			if (count === 0) continue;
			executionAddressSpace.bindReadOnlyView(domain, readLE32(header, h + tableOffset), count * BLUA32_GLOBAL_NAME_RECORD_SIZE, view);
			for (let slot = 0; slot < count; ++slot) {
				const name = stringPool.resolveImageRecord(domain, readLE32(view.bytes, view.byteOffset + slot * BLUA32_GLOBAL_NAME_RECORD_SIZE + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET));
				memory.writeRamRecordWord(output, bank.registerName(name));
				output += 4;
			}
		}
		let ordinal = 0, ramCount = 0;
		for (let slot = 0; slot < constantCount; ++slot) {
			const word = c + slot * BLUA32_CONSTANT_RECORD_SIZE;
			if (readLE32(constants, word + BLUA32_CONSTANT_TAG_OFFSET) !== Blua32ConstantTag.String) continue;
			const id = stringPool.resolveImageRecord(domain, readLE32(constants, word + BLUA32_CONSTANT_PAYLOAD_OFFSET));
			ramCount = storeImageStringBinding(memory, output, stringCount, ordinal++, ramCount, id);
		}
		const binding = executionImageBindingOffset(management, domain);
		memory.writeRamRecordPair(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, output, ramCount);
		memory.writeRamRecordPair(binding, base, bytes);
	}
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
