import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import * as v from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { formatFloat, formatInteger } from '../../machine/ts/common/number_format';
import { f32BitsToNumber } from '../../machine/ts/common/float32';

function words(): number[] {
	const result = [0, 0x80000000, 1, 0x7fffff, 0x800000, 0x3f800000, 0x40000000,
		0x4b800000, 0x4b800001, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000, 0x7fa12345, 0xffc00000];
	for (let exponent = 1; exponent < 255; ++exponent)
		for (const mantissa of [0, 1, 0x400000, 0x7fffff]) result.push((exponent << 23) | mantissa);
	let seed = 0xbadcafe;
	for (let i = 0; i < 16384; ++i) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; result.push(seed >>> 0); }
	return result;
}
// Independent exact rational oracle. BigInts belong only to this test, never
// to the runtime formatter or its reusable scratch.
function decimalOracle(bits: number): string {
	const magnitude = bits & 0x7fffffff, sign = bits >>> 31 ? '-' : '';
	if (magnitude > 0x7f800000) return 'nan';
	if (magnitude === 0x7f800000) return sign + 'inf';
	if (magnitude === 0) return sign + '0.0';
	const encodedExponent = magnitude >>> 23;
	const mantissa = BigInt((magnitude & 0x7fffff) | (encodedExponent === 0 ? 0 : 0x800000));
	const binaryExponent = encodedExponent === 0 ? -149 : encodedExponent - 150;
	let numerator = mantissa, denominator = 1n;
	if (binaryExponent >= 0) numerator <<= BigInt(binaryExponent); else denominator <<= BigInt(-binaryExponent);
	let exponent = 0, scale = 1n;
	while (numerator >= denominator * scale * 10n) { scale *= 10n; ++exponent; }
	if (numerator < denominator) {
		let scaled = numerator;
		while (scaled < denominator) { scaled *= 10n; --exponent; }
	}
	const decimalScale = 6 - exponent;
	if (decimalScale >= 0) numerator *= 10n ** BigInt(decimalScale); else denominator *= 10n ** BigInt(-decimalScale);
	let digits = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder * 2n > denominator || (remainder * 2n === denominator && (digits & 1n) !== 0n)) ++digits;
	if (digits === 10000000n) { digits = 1000000n; ++exponent; }
	const text = digits.toString(); let end = 7;
	while (end > 1 && text[end - 1] === '0') --end;
	if (exponent >= -4 && exponent < 7) {
		const point = exponent + 1;
		return point > 0 ? sign + text.slice(0, point) + (end > point ? '.' + text.slice(point, end) : '.0')
			: sign + '0.' + '0'.repeat(-point) + text.slice(0, end);
	}
	return sign + text[0] + (end > 1 ? '.' + text.slice(1, end) : '') + 'e' + (exponent < 0 ? '-' : '+') + Math.abs(exponent).toString().padStart(2, '0');
}

test('Value identity is tag/word, not JS object shape, NaN space or numeric integrality', () => {
	for (const word of words()) for (let tag = v.ValueTag.Nil; tag <= v.ValueTag.DeadKey; ++tag) {
		const value = v.valueFromTag(tag, word);
		assert.equal(v.valueTag(value), tag); assert.equal(v.valuePayload(value), word);
	}
	assert.notEqual(v.valueInteger(2), v.valueFloat(2)); assert.ok(v.valuesEqual(v.valueInteger(2), v.valueFloat(2)));
	assert.ok(!v.valuesEqual(v.valueInteger(16777217), v.valueFloat(16777216)));
	assert.ok(!v.valuesEqual(v.valueFloatBits(0x7fc00000), v.valueFloatBits(0x7fc00000)));
	assert.ok(v.tableKeysEqual(v.valueFloatBits(0xffa12345), v.valueFloatBits(0x7fc00000)));
	assert.equal(v.hashCanonicalTableKey(v.valueInteger(2)), v.hashCanonicalTableKey(v.canonicalTableKey(v.valueFloat(2))));
	assert.ok(v.tableKeysEqual(v.valueInteger(0), v.valueFloatBits(0x80000000)));
	assert.ok(v.valuesEqual(v.valueFromTag(v.ValueTag.True, 1), v.valueFromTag(v.ValueTag.True, 2)));
	assert.ok(v.tableKeysEqual(v.valueFromTag(v.ValueTag.True, 1), v.valueBool(true)));
	assert.equal(v.asBuiltinFunctionId(v.valueBuiltinFunction(0)), 0);
});

test('actual ValueSlots and Thread frame windows use five-byte backing', () => {
	const slots = new ValueSlots(17), borrowed = new ValueSlots(0);
	assert.equal(slots.byteLength(), 85);
	slots.setInteger(0, -1); slots.setFloatBits(1, 0xffa12345); slots.setTable(2, 0xffffffff);
	borrowed.rebind(slots, 1, 5); assert.equal(borrowed.get(0), v.valueFloatBits(0xffa12345));
	borrowed.copyWithin(1, 0, 3); assert.equal(slots.get(2), v.valueFloatBits(0xffa12345));
	slots.resizeCapacity(29); assert.equal(slots.byteLength(), 145); assert.equal(slots.get(28), v.valueNil());
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const { cpu } = createTestSystemCpu(linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] }));
	const thread = cpu.rootThread, first = thread.currentFrame!;
	first.growRegisterWindow(8);
	first.registers.setFloatBits(3, 0xffc00000); thread.resizeStack(64);
	assert.equal(thread.stackRegisters.byteLength(), 320); assert.equal(first.registers.get(3), v.valueFloatBits(0xffc00000));
	thread.reserveFrame(thread.stackRegisters.capacity());
	const second = thread.acquireFrame();
	second.initializeControl(0, 0, 0, false, -1, 0, 0, 0, 0, 0, 0, 4, 4);
	thread.enterFrame(second);
	second.registers.setInteger(0, 123); thread.resizeStack(96);
	assert.equal(second.registers.getInteger(0), 123); assert.equal(first.registers.get(3), v.valueFloatBits(0xffc00000));
	thread.leaveFrame(); assert.equal(thread.currentFrame, first);
});

test('seven-digit Float text agrees with exact binary rational rounding over the full exponent range', () => {
	for (const word of words()) assert.equal(formatFloat(f32BitsToNumber(word)), decimalOracle(word), word.toString(16));
	for (let i = 128; i < 4096; ++i) {
		const value = v.valueFloat(i / 128);
		assert.equal(formatFloat(v.asFloat(value)), decimalOracle(v.valuePayload(value)));
	}
	assert.equal(formatInteger(-2147483648), '-2147483648');
	assert.equal(formatFloat(10000000), '1e+07'); assert.equal(formatFloat(2), '2.0');
});

const runner = process.env.BMSX_VALUE32_RUNNER;
test('native Value fields, key hashes and Float text match TypeScript word for word', { skip: !runner }, () => {
	const input: string[] = [], expected: string[] = [];
	for (const word of words()) {
		input.push(`F ${word.toString(16)} 0`); expected.push(formatFloat(f32BitsToNumber(word)));
		input.push(`I ${word.toString(16)} 0`); expected.push(formatInteger(word | 0));
		for (const tag of [v.ValueTag.Integer, v.ValueTag.Float, v.ValueTag.String, v.ValueTag.BuiltinFunction, v.ValueTag.Table, v.ValueTag.Closure, v.ValueTag.Thread]) {
			const value = v.valueFromTag(tag, word);
			input.push(`V ${tag.toString(16)} ${word.toString(16)}`); expected.push(`${value.toString(16)} ${v.canonicalTableKey(value).toString(16)}`);
			input.push(`H ${tag.toString(16)} ${word.toString(16)}`); expected.push(v.hashCanonicalTableKey(v.canonicalTableKey(value)).toString(16));
		}
	}
	const actual = execFileSync(runner!, ['--vectors'], { input: input.join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; ++i) assert.equal(actual[i], expected[i], input[i]);
});
