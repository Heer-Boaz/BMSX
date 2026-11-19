import assert from 'node:assert/strict';
import test from 'node:test';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { FixtureOperations, type FixtureOutput } from '../../ide/testing/fixture_operations';
import { TestInput } from '../../ide/testing/input';
import { valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, valueTable, type Value } from '../../machine/ts/machine/cpu/value';
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
	cpu.collectTrackedHeapBytes();
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
	// Same byte length so this allocation reuses a slot in the same size class.
	const unrelatedKey = pool.intern('unreach');
	assert.equal(unrelatedKey, retiredKey, 'the old key slot is now a different string');
	const reachedKey = pool.intern('reached');
	assert.notEqual(reachedKey, retiredKey);
	const receipt = cpu.createTable(0, 2);
	cpu.gc.tables.setStringKey(receipt, unrelatedKey, valueBool(true));
	cpu.gc.tables.setStringKey(receipt, reachedKey, valueBool(false));
	cpu.setGlobalByKey(pool.intern('receipt'), valueTable(receipt));

	operations.accept([valueNil(), valueString(pool.intern('boundary')), valueTable(receipt), valueInteger(100)]);
	assert.equal(operations.observesPublication, true);
	assert.equal(operations.shouldStopAtPublication(), false, 'an unrelated true field cannot publish the boundary');
	cpu.gc.tables.setStringKey(receipt, reachedKey, valueBool(true));
	assert.equal(operations.shouldStopAtPublication(), true);
	const args: Value[] = [];
	assert.equal(operations.advance(args, 0), true);
	assert.equal(args[1], valueBool(true), 'the actual reached result is returned to the compiled fixture');
	assert.equal(operations.waiting, false);
	assert.equal(bindingChanges, 2, 'entering and retiring the boundary update its execution-hook admission');
});

test('fixture wire values decode at input/wait boundaries and replies remain encoded Values', t => {
	const code = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.RET, 0, 0, 0);
	const image = linkRawTestSystemBlua32({text: code, functions: [{firstWord: 0, wordCount: 1}],
		systemGlobalNames: LUA_BOOT_PRIMITIVES.map(primitive => primitive.name)});
	const input = new TestInput(), target = new OffscreenMachine(image.romBytes, [null, null], PSX_MACHINE_SPEC, input);
	t.after(() => target.dispose());
	const cpu = target.runtime.machine.cpu, pool = cpu.stringPool, frame = target.runtime.frameScheduler;
	const recorder = cpu.createTable(0,0), logs: Value[] = [], captures: (number|string)[][] = [];
	const output: FixtureOutput = {
		log(_tick,value) {logs.push(value);},
		captureRequested(tick,label) {captures.push([tick,label]);},
		captured(sequence,label) {captures.push([sequence,label]);},
		observeFsm(value) {assert.equal(value,recorder);},
		observeActionEffects(value) {assert.equal(value,recorder);},
	};
	const operations = new FixtureOperations(target,input,output,()=>{});
	const key = t.mock.method(input,'key'), press = t.mock.method(input,'press');
	const operation = (name: string,...args: Value[]) => [valueNil(),valueString(pool.intern(name)),...args];
	operations.accept(operation('key',valueString(pool.intern('KeyA')),valueBool(false),valueNil()));
	assert.deepEqual(key.mock.calls.at(-1)!.arguments,['KeyA',false,null]); operations.cancel();
	operations.accept(operation('press',valueString(pool.intern('a')),valueFloat(2),valueFloat(1)));
	assert.deepEqual(press.mock.calls.at(-1)!.arguments,['a',2,1]); operations.cancel();
	operations.accept(operation('fsm',valueTable(recorder)));
	operations.accept(operation('actioneffects',valueTable(recorder)));
	operations.accept(operation('log',valueFloatBits(0xffc54321)));
	assert.deepEqual(logs,[valueFloatBits(0xffc54321)]);
	t.mock.method(target,'advanceGame',()=>true);
	const args: Value[] = [];
	frame.lastTickSequence = 10;
	operations.accept(operation('ticks',valueInteger(16777217)));
	frame.lastTickSequence = 16777226; assert.equal(operations.advance(args,0),false);
	frame.lastTickSequence++; assert.equal(operations.advance(args,0),true,'Integer ticks are not narrowed to binary32');
	frame.lastTickSequence = 20;
	operations.accept(operation('ticks',valueFloat(1.5)));
	frame.lastTickSequence = 21; assert.equal(operations.advance(args,0),false);
	frame.lastTickSequence = 22; assert.equal(operations.advance(args,0),true);

	const receipt = cpu.createTable(0,1); cpu.gc.tables.setStringKey(receipt, pool.intern('reached'),valueInteger(0));
	operations.accept(operation('boundary',valueTable(receipt),valueFloat(10)));
	assert.equal(operations.shouldStopAtPublication(),true,'the transport uses guest truth, not host booleans');
	assert.equal(operations.advance(args,0),true); assert.equal(args[1],valueInteger(0));
	operations.accept(operation('capture',valueString(pool.intern('accepted'))));
	t.mock.method(target,'present',()=>true);
	t.mock.getter(target.presenter,'presentationSequence',()=>0x80000001);
	frame.lastTickSequence++;
	assert.equal(operations.advance(args,0),true);
	assert.equal(args[1],valueInteger(0x80000001));
	assert.deepEqual(captures,[[22,'accepted'],[0x80000001,'accepted']]);
	assert.equal(operations.accept(operation('unsupported')),'unsupported');
});
