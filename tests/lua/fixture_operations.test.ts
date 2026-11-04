import assert from 'node:assert/strict';
import test from 'node:test';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { FixtureOperations, type FixtureOutput } from '../../ide/testing/fixture_operations';
import { TestInput } from '../../ide/testing/input';
import { ValueTag, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

test('fixture publication follows the current receipt key after string collection and ID reuse', t => {
	const code = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text: code, functions: [{ firstWord: 0, wordCount: 1 }],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name) });
	const input = new TestInput(), target = new OffscreenMachine(image.romBytes, [null, null], PSX_MACHINE_SPEC, input);
	t.after(() => target.dispose());
	const cpu = target.runtime.machine.cpu, pool = cpu.stringPool;
	const retiredKey = pool.intern('reached');
	const output: FixtureOutput = {
		log() { assert.fail('Boundary waiting does not publish a log.'); },
		captureRequested() { assert.fail('Boundary waiting does not request a capture.'); },
		captured() { assert.fail('Boundary waiting does not publish a capture.'); },
		observeFsm() { assert.fail('Boundary waiting does not subscribe to an FSM recorder.'); },
		observeActionEffects() { assert.fail('Boundary waiting does not subscribe to an effect recorder.'); },
	};
	let bindingChanges = 0;
	const operations = new FixtureOperations(target, input, output, () => { bindingChanges++; });
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('reached'), undefined, 'constructing the fixture transport does not root guest field names');
	const unrelatedKey = pool.intern('unrelated field');
	assert.equal(unrelatedKey, retiredKey, 'the old key slot is now a different string');
	const reachedKey = pool.intern('reached');
	assert.notEqual(reachedKey, retiredKey);
	const receipt = cpu.createTable(0, 2);
	receipt.setStringKey(unrelatedKey, true);
	receipt.setStringKey(reachedKey, false);
	cpu.setGlobalByKey(pool.intern('receipt'), ValueTag.Table, NaN, receipt);

	operations.accept([null, valueString(pool.intern('boundary')), receipt, 100]);
	assert.equal(operations.observesPublication, true);
	assert.equal(operations.shouldStopAtPublication(), false, 'an unrelated true field cannot publish the boundary');
	receipt.setStringKey(reachedKey, true);
	assert.equal(operations.shouldStopAtPublication(), true);
	const args: Value[] = [];
	assert.equal(operations.advance(args, 0), true);
	assert.equal(args[1], true, 'the actual reached result is returned to the compiled fixture');
	assert.equal(operations.waiting, false);
	assert.equal(bindingChanges, 2, 'entering and retiring the boundary update its execution-hook admission');
});
