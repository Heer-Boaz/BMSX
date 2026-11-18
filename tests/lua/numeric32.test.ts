import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { f32BitsToNumber, numberToF32Bits } from '../../machine/ts/common/float32';
import * as n from '../../machine/ts/spec/blua32/numeric';

type Vector = { op: string; left: number; right: number };
const floatWords = [0, 0x80000000, 1, 2, 0x80000001, 0x7fffff, 0x800000, 0x3f000000,
	0x3f800000, 0xbf800000, 0x3dcccccd, 0x4b800000, 0x4b800001, 0x4effffff,
	0x4f000000, 0xcf000000, 0x4f800001, 0x7f7fffff, 0xff7fffff, 0x7f800000,
	0xff800000, 0x7fc00000, 0xffc00000, 0x7fa12345, 0xffa12345];
const integers = [0, 1, -1, 2, -2, 3, -3, 31, -31, 32, -32, 33, -33, 16777217,
	0x7fffffff, -0x80000000];

function run({ op, left, right }: Vector): number | null {
	const a = left | 0, b = right | 0;
	switch (op) {
		case 'Q': return b === 0 ? null : n.luaIntegerFloorDivide(a, b) >>> 0;
		case 'T': return b === 0 ? null : n.luaIntegerModulo(a, b) >>> 0;
		case 'L': return n.luaShiftLeft(a, b) >>> 0;
		case 'H': return n.luaShiftRight(a, b) >>> 0;
		case 'C': return n.luaCompareIntegerFloat(a, f32BitsToNumber(right)) >>> 0;
		case 'A': return n.luaFloatAddBits(left, right);
		case 'S': return n.luaFloatSubtractBits(left, right);
		case 'M': return n.luaFloatMultiplyBits(left, right);
		case 'D': return n.luaFloatDivideBits(left, right);
		case 'F': return n.luaFloatFloorDivideBits(left, right);
		case 'R': return n.luaFloatModuloBits(left, right);
		case 'N': return n.luaFloatNegateBits(left);
		case 'W': return n.luaFloatToWord(left);
		case 'I': { const result = n.luaFloatToInteger(left); return result === null ? null : result >>> 0; }
		default: throw new Error('unknown numeric test operation');
	}
}
function vectors(): Vector[] {
	const result: Vector[] = [];
	for (const left of integers) for (const right of integers)
		for (const op of ['Q', 'T', 'L', 'H']) result.push({ op, left: left >>> 0, right: right >>> 0 });
	for (const left of floatWords) for (const right of floatWords)
		for (const op of ['A', 'S', 'M', 'D', 'F', 'R', 'N', 'W', 'I']) result.push({ op, left, right });
	for (const left of integers) for (const right of floatWords) result.push({ op: 'C', left: left >>> 0, right });
	let seed = 0xdecafbad;
	for (let i = 0; i < 4096; ++i) {
		seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const left = seed >>> 0;
		seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const right = seed >>> 0;
		for (const op of ['Q', 'T', 'L', 'H', 'C', 'A', 'S', 'M', 'D', 'F', 'R', 'N', 'W', 'I']) result.push({ op, left, right });
	}
	return result;
}

test('integer datapath agrees with mathematical integer and logical-word rules', () => {
	for (const v of vectors()) {
		const a = BigInt(v.left | 0), b = BigInt(v.right | 0);
		if ((v.op === 'Q' || v.op === 'T') && b !== 0n) {
			let q = a / b, r = a % b;
			if (r !== 0n && ((r < 0n) !== (b < 0n))) { --q; r += b; }
			assert.equal(run(v), Number(BigInt.asUintN(32, v.op === 'Q' ? q : r)));
		}
		if (v.op === 'L' || v.op === 'H') {
			let count = b, left = v.op === 'L';
			if (count < 0n) { count = -count; left = !left; }
			const word = BigInt(v.left), shifted = count >= 32n ? 0n : left ? word << count : word >> count;
			assert.equal(run(v), Number(BigInt.asUintN(32, shifted)));
		}
	}
});

test('binary32 operations round individually, with gradual underflow and observable NaN sign', () => {
	assert.equal(n.luaFloatAddBits(0x4b800000, 0x3f800000), 0x4b800000);
	assert.equal(n.luaFloatAddBits(1, 1), 2);
	assert.equal(n.luaFloatMultiplyBits(0x00800000, 0x3f000000), 0x00400000);
	assert.equal(n.luaFloatMultiplyBits(1, 0x3f000000), 0);
	assert.equal(n.luaFloatMultiplyBits(1, 0x3fc00000), 2);
	assert.equal(n.luaFloatFloorDivideBits(0x40400001, 0x3f800001), 0x40400000);
	assert.equal(n.luaFloatDivideBits(0, 0), 0x7fc00000);
	assert.equal(n.luaFloatNegateBits(n.luaFloatDivideBits(0, 0)), 0xffc00000);
	assert.equal(n.luaFloatNegateBits(0x7fa12345), 0xffa12345);
	assert.equal(n.luaFloatModuloBits(0x80000000, 0xc0400000), 0x80000000);
	for (const bits of floatWords) assert.equal(n.luaFloatNegateBits(n.luaFloatNegateBits(bits)), bits);
});

test('mixed compare and conversion retain the int32 boundary and reject invalid words', () => {
	assert.equal(n.luaCompareIntegerFloat(16777217, 16777216), n.NumericOrder.Greater);
	assert.equal(n.luaCompareIntegerFloat(2147483647, 2147483648), n.NumericOrder.Less);
	for (const bits of floatWords) {
		const value = f32BitsToNumber(bits), finite = (bits & 0x7fffffff) < 0x7f800000;
		assert.equal(n.luaFloatToWord(bits), finite ? Math.trunc(value) >>> 0 : null);
		assert.equal(n.luaFloatToInteger(bits), value >= -2147483648 && value < 2147483648 && Math.trunc(value) === value ? value | 0 : null);
		for (const integer of integers) {
			const expected = integer < value ? -1 : integer > value ? 1 : integer === value ? 0 : 2;
			assert.equal(n.luaCompareIntegerFloat(integer, value), expected);
		}
	}
	assert.equal(numberToF32Bits(-0), 0x80000000);
});

const nativeRunner = process.env.BMSX_NUMERIC32_RUNNER;
test('raw binary32 and integer results match the native datapath bit-for-bit', { skip: !nativeRunner }, () => {
	const cases = vectors(), input = cases.map(v => `${v.op} ${v.left.toString(16)} ${v.right.toString(16)}`).join('\n') + '\n';
	const actual = execFileSync(nativeRunner!, ['--vectors'], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split('\n');
	assert.equal(actual.length, cases.length);
	for (let i = 0; i < cases.length; ++i) {
		const expected = run(cases[i]);
		assert.equal(actual[i], expected === null ? 'invalid' : expected.toString(16), JSON.stringify(cases[i]));
	}
});
