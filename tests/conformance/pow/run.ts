import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { luaPow } from '../../../machine/ts/spec/blua32/pow';
import { numberHighWord, numberLowWord, numberWithHighWord, numberWithLowWord } from '../../../machine/ts/common/float64';

const command = process.argv.slice(2);
if (command.length === 0) {
	assert.equal(spawnSync('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'], { stdio: 'inherit' }).status, 0);
	assert.equal(spawnSync('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_pow_conformance_runner', '--parallel', '4'], { stdio: 'inherit' }).status, 0);
	command.push('build-cpp-tests/bmsx_pow_conformance_runner');
}
const cases: [number, number][] = [];
const boundaries = [0, -0, 1, -1, 2, -2, 0.5, -0.5, Infinity, -Infinity, NaN, Number.MIN_VALUE,
	Number.MAX_VALUE, 2.2250738585072014e-308, 1.0000000000000002, 0.9999999999999999,
	3, -3, 1024, -1074, -1075, 2147483649, -2147483649, 9007199254740992];
for (const x of boundaries) for (const y of boundaries) cases.push([x, y]);
for (let i = -2400; i <= 2400; i++) { cases.push([10, i / 200], [2, i / 120]); }
let seed = 0x18625738;
for (let i = 0; i < 20000; i++) {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	const high = seed;
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	const x = numberWithLowWord(numberWithHighWord(0, high), seed);
	cases.push([x, (i % 73 - 36) / 12]);
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-pow-')), path = join(directory, 'vectors.txt');
writeFileSync(path, cases.map(([x, y]) => [numberHighWord(x) >>> 0, numberLowWord(x), numberHighWord(y) >>> 0, numberLowWord(y)].join(' ')).join('\n'));
const native = spawnSync(command[0], [...command.slice(1), path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const lines = native.stdout.trim().split('\n');
assert.equal(lines.length, cases.length);
for (let i = 0; i < cases.length; i++) {
	const [x, y] = cases[i], value = luaPow(x, y);
	assert.deepEqual(lines[i].split(' ').map(Number), [numberHighWord(value) >>> 0, numberLowWord(value)], `${i}: ${x} ^ ${y}; ${directory}`);
}
rmSync(directory, { recursive: true });
console.log(`POW-PARITY:PASS (${cases.length} binary64 vectors)`);
