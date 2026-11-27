import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, CLOSURE_LATCHED_PROTOTYPE, closureRecordBytes } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
	BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_MAPPED_CODE_FLAG,
} from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_CAPTURE_BINDING_OFFSET, HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_FIRMWARE_DATA_OFFSET, HeapServiceCaptureBindingField } from '../../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { rewriteResolvedABx } from '../../../toolchain/ts/rompack/blua32_linker';
import { linkTestBlua32Pair, linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
bss prototype: word[256]
local function make()
	local value = test_payload
	test_first_write = value
	test_second_write = value
	return value
end
local function payload(a, b, c, d, e, f, g) return a + g end
test_payload = payload
test_factory = make
local first = test_factory()
local second = test_factory()
local third = test_factory()
local fourth = test_factory()
return 10 * (first(7, 0, 0, 0, 0, 0, 701) + fourth(7, 0, 0, 0, 0, 0, 701)) +
	(first == second and 1 or 0) + (first ~= third and 2 or 0) + (third == fourth and 4 or 0)
`;
const boot = `cop0.exec = mem32le[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;

const folder = mkdtempSync(join('tmp', 'bmsx-mapped-captureless-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const level of [0, 3] as const) for (const domain of ['system', 'cart'] as const) {
		const pair = domain === 'cart' ? linkTestBlua32Pair(compileHeapServiceSystem(boot, level),
			compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source, optLevel: level })) : null;
		const single = pair === null ? linkTestSystemBlua32(compileHeapServiceSystem(source, level)) : null;
		const image = pair?.cartImage ?? single!.image, base = pair ? CART_ROM_BASE : SYSTEM_ROM_BASE;
		const system = pair?.systemRomBytes ?? single!.romBytes.slice(), cart = pair?.cartRomBytes.slice() ?? null;
		const owning = cart ?? system;
		if (cart !== null) writeLE32(cart, image.address - base + BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG);
		const symbols = pair?.cartSymbols ?? single!.symbols;
		const findFunction = (name: string) => image.functions[symbols.metadata.functionDisplayNames.indexOf(name)];
		const target = findFunction('payload'), factory = findFunction('make');
		assert.ok(target && factory, symbols.metadata.functionDisplayNames.slice(0, 16).join(', '));
		assert.ok(factory.codeByteCount >= 3 * INSTRUCTION_BYTES);
		const issue = factory.codeAddress, word = (issue - base) / INSTRUCTION_BYTES;
		const prototype = image.header.bssAddress;
		// The source provides a real, invoked factory and function body. Replace
		// the factory's first words with the machine's mapped prototype form.
		writeInstruction(owning, word, OpCode.WIDE, 0, 0, 0);
		writeInstruction(owning, word + 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(owning, word + 2, OpCode.RET, 0, 2, 0);
		rewriteResolvedABx(owning, word + 1, OpCode.CLOSURE, prototype / BLUA32_FUNCTION_ALIGNMENT);
		const decoded = decodeBlua32InstructionAtPc(owning, base, issue);
		const codeExtent = target.codeByteCount;
		const firstCode = prototype + BLUA32_FUNCTION_RECORD_SIZE, secondCode = firstCode + codeExtent;
		assert.ok(codeExtent > 0 && BLUA32_FUNCTION_RECORD_SIZE + 2 * codeExtent <= 256 * INSTRUCTION_BYTES);
		for (const canonical of [false, true]) {
			const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const arena = cpu.heapAllocator, management = arena.managementOffset();
			const continuation = management + HEAP_SERVICE_CLOSURE_OFFSET;
			const workspace = management + HEAP_SERVICE_FIRMWARE_DATA_OFFSET, workspaceEnd = management + RUNTIME_MANAGEMENT_SIZE;
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const atIssue = () => !cpu.heapServiceActive() && cpu.getFrameDepth() > 0 &&
				cpu.activeCartridgeSlot() === (domain === 'cart' ? 0 : -1) && cpu.readFramePc(cpu.getFrameDepth() - 1) === issue;
			for (let grant = 0; grant < 8192 && !atIssue(); ++grant)
				assert.notEqual(slice(cpu.heapServiceActive() ? 193 : 1), RunResult.Halted);
			assert.ok(atIssue());
			const flags = (target.flags & ~BLUA32_FUNCTION_STATIC) | (canonical ? BLUA32_FUNCTION_STATIC : 0);
			for (const [offset, value] of [
				[BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, firstCode], [BLUA32_FUNCTION_NUM_PARAMS_OFFSET, target.numParams],
				[BLUA32_FUNCTION_MAX_STACK_OFFSET, target.maxStack], [BLUA32_FUNCTION_FLAGS_OFFSET, flags],
				[BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, 0xffffffff], [BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, 0],
			]) memory.writeMappedWord(prototype + offset, value);
			for (let offset = 0; offset < codeExtent; offset += INSTRUCTION_BYTES) {
				const word = readLE32(owning, target.codeAddress - base + offset);
				memory.writeMappedWord(firstCode + offset, word);
				memory.writeMappedWord(secondCode + offset, word);
			}
			const stem = join(folder, `O${level}-${domain}-${canonical ? 'static' : 'dynamic'}`);
			const systemPath = stem + '.rom', seed = stem + '.seed', checkpoint = stem + '.checkpoint';
			const media = cart === null ? [] : [stem + '.cart'];
			writeFileSync(systemPath, system);
			if (cart !== null) writeFileSync(media[0], cart);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const commands: string[] = [], rows: string[] = [];
			const grant = (cycles: number) => {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
				commands.push(`J ${cycles} 1`);
				rows.push(`${result} ${spent} ${+cpu.heapServiceActive()} ${memory.readRamRecordWord(continuation)} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				return spent;
			};
			const writeCodeAddress = (address: number) => {
				memory.writeMappedWord(prototype + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, address);
				commands.push(`O ${prototype + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET} ${address}`);
			};
			const faults = memory.readBusFaultSequence(), seen: number[] = [];
			const oldWork = memory.ramData().slice(workspace, workspaceEnd);
			let commandCut = 0, rowCut = 0;
			function finish() {
				for (let visit = seen.length; visit < 4; ++visit) {
					for (let n = 0; n < 8192 && !atIssue(); ++n) grant(cpu.heapServiceActive() ? 193 : 1);
					assert.ok(atIssue());
					const code = visit < 2 ? firstCode : secondCode;
					writeCodeAddress(code);
					const previousBytes = cpu.luaHeap.usedBytes(), frame = cpu.activeThread.currentFrame!;
					assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
					const miss = !canonical || (visit & 1) === 0;
					assert.equal(cpu.heapServiceActive(), miss);
					if (visit === 0) {
						// The live record no longer describes callable code, but its
						// sample remains bound across the private service and rewind.
						writeCodeAddress(0xffffffff);
						grant(1);
						const state = captureRuntimeSaveState(runtime);
						assert.equal(readLE32(state.ram, management + HEAP_SERVICE_CAPTURE_BINDING_OFFSET + HeapServiceCaptureBindingField.Count), 0);
						assert.deepEqual(state.ram.subarray(workspace, workspaceEnd), oldWork);
						writeFileSync(checkpoint, encodeRuntimeSaveState(state));
						commandCut = commands.length; rowCut = rows.length;
					}
					for (let n = 0; n < 4096 && cpu.heapServiceActive(); ++n) grant(127);
					assert.equal(cpu.heapServiceActive(), false);
					assert.equal(cpu.luaHeap.usedBytes(), previousBytes + (miss ? closureRecordBytes(0, true) : 0));
					const closure = valuePayload(frame.registers.get(decoded.a));
					assert.equal(memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS), (domain === 'cart' ? 1 : 0)
						| CLOSURE_LATCHED_PROTOTYPE | (canonical ? CLOSURE_CANONICAL : 0));
					assert.equal(cpu.captureClosureBinding(closure).codeAddress, code);
					seen.push(closure);
				}
				assert.equal(seen[0] === seen[1], canonical);
				assert.notEqual(seen[0], seen[2]);
				assert.equal(seen[2] === seen[3], canonical);
				assert.deepEqual(memory.ramData().subarray(workspace, workspaceEnd), oldWork, 'zero captures never write the BIOS plan');
				for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(127);
				const expected = 14_162 + (canonical ? 5 : 0);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(expected)]);
				assert.equal(memory.readBusFaultSequence(), faults, 'the nonexistent descriptor is not read');
				commands.push('C'); rows.push(String(expected));
				const first = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
				commands.push(`H ${first} ${end}`);
				rows.push(String(hashBytes(memory.ramData(), first, end - first)));
			}
			finish();
			for (const restored of [false, true]) {
				const trace = stem + (restored ? '.restore.trace' : '.trace');
				writeFileSync(trace, ['X', ...(restored ? commands.slice(commandCut) : commands)].join('\n'));
				const output = execFileSync(native, [systemPath, trace, restored ? checkpoint : seed, ...media], { encoding: 'utf8' }).trimEnd().split('\n');
				assert.deepEqual(output, restored ? rows.slice(rowCut) : rows, stem);
			}
			console.log(`MAPPED-CAPTURELESS:PASS O${level} ${domain} ${canonical ? 'canonical' : 'dynamic'} (exact grants, cache identity, RAM and portable restore)`);
		}
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
