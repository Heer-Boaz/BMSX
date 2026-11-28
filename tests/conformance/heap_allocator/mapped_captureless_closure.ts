import { CLOSURE_CANONICAL } from '../../../toolchain/ts/firmware/stock_object_layout';
import { MANAGED_CART_LAUNCH } from '../../helpers/managed_cart_launch';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_BINDING_FLAGS, CLOSURE_LATCHED_PROTOTYPE, closureRecordBytes } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_FUNCTION_BINDING } from '../../../machine/ts/spec/blua32/cop0';
import {
	BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_STATIC,
	BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, BLUA32_IMAGE_FLAGS_OFFSET,
	BLUA32_IMAGE_MAPPED_CODE_FLAG,
} from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkCartBlua32Image, rewriteResolvedABx } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

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
const boot = MANAGED_CART_LAUNCH;

const folder = mkdtempSync(join(tmpdir(), 'bmsx-mapped-captureless-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const level of [0, 3] as const) for (const domain of ['system', 'cart'] as const) {
		const checkWeak = level === 3 && domain === 'system';
		const program = checkWeak ? `local heap_calls<const> = require('kernel/heap_control_ids')
` + source.replace('local first =', 'local function create_versions()\nlocal first =')
			.replace('return 10 *', 'local sum = 10 *') + `
return sum, third
end
fixture_versions = create_versions
local sum, third = fixture_versions()
halt_until_irq
blua32.svc(heap_calls.collect_full)
halt_until_irq
local fifth, sixth = test_factory(), test_factory()
return sum + (fifth == sixth and 8 or 0) + (third(7, 0, 0, 0, 0, 0, 701) == 708 and 16 or 0)
` : source;
		const linked = linkManagedTestSystem(domain === 'cart' ? boot : program, level);
		const card = domain === 'cart' ? (() => {
			const compiled = compileLuaChunkToProgram(parseLuaChunk(source), [], { entrySource: source, optLevel: level });
			return linkCartBlua32Image(linked.biosImports, encodeCompiledProgramObject(compiled), compiled.metadata,
				CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		})() : null;
		const image = (card ?? linked).layout, base = card ? CART_ROM_BASE : SYSTEM_ROM_BASE;
		const system = writeTestBlua32Rom(linked), cart = card === null ? null : writeTestBlua32Rom(card);
		const owning = cart ?? system;
		if (cart !== null) writeLE32(cart, image.address - base + BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG);
		const symbols = (card ?? linked).symbols;
		const findFunction = (name: string) => image.functions[symbols.metadata.functionDisplayNames.indexOf(name)];
		const target = findFunction('payload'), factory = findFunction('make');
		assert.ok(target && factory, symbols.metadata.functionDisplayNames.slice(0, 16).join(', '));
		assert.ok(factory.codeByteCount >= 3 * INSTRUCTION_BYTES);
		const issue = factory.codeAddress, word = (issue - base) / INSTRUCTION_BYTES;
		const alignment = BLUA32_FUNCTION_ALIGNMENT - 1;
		const prototype = (image.header.bssAddress + alignment) & ~alignment;
		// The source provides a real, invoked factory and function body. Replace
		// the factory's first words with the machine's mapped prototype form.
		writeInstruction(owning, word, OpCode.WIDE, 0, 0, 0);
		writeInstruction(owning, word + 1, OpCode.CLOSURE, 0, 0, 0);
		writeInstruction(owning, word + 2, OpCode.RET, 0, 2, 0);
		rewriteResolvedABx(owning, word + 1, OpCode.CLOSURE, prototype / BLUA32_FUNCTION_ALIGNMENT);
		const decoded = decodeBlua32InstructionAtPc(owning, base, issue);
		const codeExtent = target.codeByteCount;
		const firstCode = prototype + BLUA32_FUNCTION_RECORD_SIZE, secondCode = firstCode + codeExtent;
		assert.ok(codeExtent > 0 && secondCode + codeExtent <= image.header.bssAddress + image.header.bssByteCount);
		for (const canonical of [false, true]) {
			const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine;
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const atIssue = () => !cpu.fixedInterruptActive() && cpu.getFrameDepth() > 0 &&
				cpu.activeCartridgeSlot() === (domain === 'cart' ? 0 : -1) && cpu.readFramePc(cpu.getFrameDepth() - 1) === issue;
			for (let grant = 0; grant < 131072 && !atIssue(); ++grant)
				assert.notEqual(slice(1), RunResult.Halted);
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
				commands.push(`E ${cycles}`);
				rows.push(`${result} ${spent} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
				return spent;
			};
			const writeCodeAddress = (address: number) => {
				memory.writeMappedWord(prototype + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, address);
				commands.push(`O ${prototype + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET} ${address}`);
			};
			const faults = memory.readBusFaultSequence(), seen: number[] = [];
			let commandCut = 0, rowCut = 0;
			function reachHalt() {
				for (let n = 0; n < 8192 && !cpu.isHaltedUntilIrq(); ++n) grant(31);
				assert.ok(cpu.isHaltedUntilIrq());
			}
			function wake() {
				cpu.clearHaltUntilIrq();
				commands.push('h');
			}
			function finish() {
				for (let visit = seen.length; visit < (checkWeak ? 6 : 4); ++visit) {
					if (visit === 4) {
						reachHalt();
						assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(seen[0]), seen[0], 'first version was not freed prematurely');
						wake();
						reachHalt();
						assert.equal(nativeHeapReference(cpu).gc.phase(), GcPhase.Pause);
						assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(seen[0]), 0, 'the index did not root the former version');
						assert.equal(nativeHeapReference(cpu).gc.closureRecordAddress(seen[2]), seen[2], 'the strongly reachable other version survived');
						wake();
					}
					for (let n = 0; n < 8192 && !atIssue(); ++n) grant(1);
					assert.ok(atIssue());
					const code = visit < 2 || visit >= 4 ? firstCode : secondCode;
					writeCodeAddress(code);
					const previousBytes = nativeHeapReference(cpu).luaHeap.usedBytes(), owner = cpu.activeThread.address, depth = cpu.getFrameDepth() - 1;
					const previous = cpu.activeThread.currentFrame!.registers.get(decoded.a);
					assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
					const miss = !canonical || (visit & 1) === 0;
					assert.ok(cpu.fixedInterruptActive());
					assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_FUNCTION_BINDING);
					assert.equal(cpu.readEpcWord(), issue);
					assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Pc), decoded.pc + INSTRUCTION_BYTES);
					assert.equal(cpu.readThreadRegister(owner, depth, decoded.a), previous);
					assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
					const packet = cpu.activeThread.currentFrame!;
					assert.equal(packet.argumentCount, 11);
					assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(r => packet.registers.get(r)),
						[decoded.a, prototype, domain === 'cart' ? 0 : -1, code, target.numParams, target.maxStack,
							flags, -1, 0, 0].map(valueInteger));
					if (visit === 0) {
						// The live record no longer describes callable code, but its
						// sample remains bound across the ordinary vector and restore.
						writeCodeAddress(0xffffffff);
						grant(1);
						writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
						commandCut = commands.length; rowCut = rows.length;
					}
					for (let n = 0; n < 4096 && cpu.fixedInterruptActive(); ++n) grant(1);
					assert.equal(cpu.fixedInterruptActive(), false);
					assert.equal(cpu.readFramePc(depth), decoded.pc + INSTRUCTION_BYTES);
					assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), previousBytes + (miss ? closureRecordBytes(0, true) : 0));
					const closure = valuePayload(cpu.activeThread.currentFrame!.registers.get(decoded.a));
					assert.equal(memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS), (domain === 'cart' ? 1 : 0)
						| CLOSURE_LATCHED_PROTOTYPE | (canonical ? CLOSURE_CANONICAL : 0));
					assert.equal(cpu.captureClosureBinding(closure).codeAddress, code);
					seen.push(closure);
				}
				assert.equal(seen[0] === seen[1], canonical);
				assert.notEqual(seen[0], seen[2]);
				assert.equal(seen[2] === seen[3], canonical);
				if (checkWeak) assert.equal(seen[4] === seen[5], canonical, 'a post-sweep miss installs a valid reusable identity');
				for (let n = 0; n < 4096 && cpu.getFrameDepth(); ++n) grant(127);
				const expected = 14_162 + (canonical ? 5 : 0) + (checkWeak ? 16 + (canonical ? 8 : 0) : 0);
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
			console.log(`MAPPED-CAPTURELESS:PASS O${level} ${domain} ${canonical ? 'canonical' : 'dynamic'} (architectural vector, identity, cycles and portable restore)`);
		}
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
