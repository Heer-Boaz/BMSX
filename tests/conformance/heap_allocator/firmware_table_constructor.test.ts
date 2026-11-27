import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const body = `
local key = 7
local advance = function() key = 9 return 41, 42 end
local t = {tag = 81}
t = { [key] = advance(), [t.tag] = 17, label -- field-name lookahead
	= 67; ['label'] = 78, 31, nil, 32, advance(), }
local wrap = function(...) return {...} end
local nested = {child = wrap(21, 22), flag = false}
return t[7], t[9], t[81], t.label, t[1], t[2], t[3], t[4], t[5],
	nested.child[1], nested.child[2], nested.flag, {}
`;
const expected = [
	valueInteger(41), valueNil(), valueInteger(17), valueInteger(78),
	valueInteger(31), valueNil(), valueInteger(32), valueInteger(41), valueNil(),
	valueInteger(21), valueNil(), valueBool(false),
];
const source = `
local aot = function() ${body} end
local actual = assert(load([=[${body}]=]))
local compiled, dynamic = table.pack(aot()), table.pack(actual())
assert(compiled.n == 13 and dynamic.n == 13)
for index = 1, 12 do
	assert(compiled[index] == dynamic[index])
end
assert(next(compiled[13]) == nil and next(dynamic[13]) == nil)
local make_wide = assert(load('return {${'0,'.repeat(513)}77, label=88}'))
local wide = make_wide()
return wide, actual()
`;

test('stock load compiles real table constructors with AOT field semantics and full-width hints', t => {
	const output = mkdtempSync(join(tmpdir(), 'bmsx-load-constructor-'));
	t.after(() => rmSync(output, { recursive: true, force: true }));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(output, 'native') });
	const { images } = compileCartlibProgram(source, { optLevel: 3 });
	const system = join(output, 'system.rom'), cart = join(output, 'cart.rom'), trace = join(output, 'trace');
	writeFileSync(system, images.systemRomBytes);
	writeFileSync(cart, images.cartRomBytes);
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes,
		cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	let result = RunResult.Yielded;
	const cycles = 20_000;
	for (let grant = 0; result !== RunResult.Halted && grant < 1_000; ++grant) {
		result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
	}
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const values = runtime.readCompletionValues();
	assert.equal(values.length, 14);
	assert.deepEqual(values.slice(1, -1), expected);
	assert.equal(valueTag(values[0]), ValueTag.Table);
	assert.equal(valueTag(values[13]), ValueTag.Table);
	const wide = valuePayload(values[0]), empty = valuePayload(values[13]), tables = cpu.gc.tables;
	assert.equal(tables.arrayCapacity(wide), 514);
	assert.equal(tables.hashSize(wide), 1);
	assert.equal(tables.getInteger(wide, 513), valueInteger(0));
	assert.equal(tables.getInteger(wide, 514), valueInteger(77));
	assert.equal(tables.getStringKey(wide, cpu.stringPool.find('label')!), valueInteger(88));
	assert.equal(tables.arrayCapacity(empty), 0);
	assert.equal(tables.hashSize(empty), 0);
	commands.push('c');
	rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [system, trace, '-', cart], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});
