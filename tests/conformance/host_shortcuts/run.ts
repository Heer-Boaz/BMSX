import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { shortcutVectors, type ShortcutTrace } from './vectors';

function run(command: string, args: string[]): string {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
const command = process.argv.slice(2);
if (command.length === 0) {
	run('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON']);
	run('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_host_shortcuts_conformance_runner', '--parallel', '4']);
	command.push('build-cpp-tests/bmsx_host_shortcuts_conformance_runner');
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-host-shortcuts-'));
const vectors = shortcutVectors();
const frames = vectors.filter(vector => vector.command.startsWith('FRAME '));
const path = join(directory, 'vectors.txt');
writeFileSync(path, vectors.map(vector => vector.command).join('\n') + '\n');
writeFileSync(join(directory, 'vectors.json'), JSON.stringify(vectors, null, 2));
const ts = run(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.base.json', '--import', './tests/lua/test_setup.ts', 'tests/conformance/host_shortcuts/ts_runner.ts', path]);
writeFileSync(join(directory, 'typescript.jsonl'), ts);
const cpp = run(command[0], [...command.slice(1), path]);
writeFileSync(join(directory, 'cpp.jsonl'), cpp);
const tsRows: ShortcutTrace[] = ts.trim().split('\n').map(line => JSON.parse(line));
const cppRows: ShortcutTrace[] = cpp.trim().split('\n').map(line => JSON.parse(line));
assert.equal(tsRows.length, frames.length, `TS trace length; evidence ${directory}`);
assert.equal(cppRows.length, frames.length, `C++ trace length; evidence ${directory}`);
for (let index = 0; index < frames.length; index++) {
	const { name, command, expected } = frames[index];
	const message = `${index}: ${name} (${command}); evidence ${directory}`;
	assert.deepEqual(cppRows[index], tsRows[index], message);
	for (const [key, value] of Object.entries(expected)) assert.deepEqual(tsRows[index][key], value, message);
}
// Independent HID assertions prevent both hosts agreeing on an incorrect capture.
const state = (name: string): ShortcutTrace => {
	const index = frames.findIndex(frame => frame.name === name);
	assert.notEqual(index, -1, `Missing expected case ${name}`);
	return tsRows[index];
};
const keyDown = (state: ShortcutTrace, code: string): boolean => {
	const usage = hidKeyUsageForCode(code);
	return (state.keys[usage >>> 5] & (1 << (usage & 31))) !== 0;
};
for (const name of ['keyboard target up first: down at zero', 'keyboard modifier up first: short release', 'keyboard modifier up first: residual hold']) {
	assert.equal(keyDown(state(name), 'ControlRight'), false, name);
	assert.equal(keyDown(state(name), 'AltRight'), false, name);
}
for (const code of ['KeyX', 'KeyZ']) assert.equal(keyDown(state('physical editing letters retain HID until release'), code), true, `${code} remains ordinary typing`);
assert.equal(keyDown(state('physical editing letters retain HID until release'), 'ControlRight'), false, 'the explicitly reserved modifier remains captured');
for (const code of ['ControlRight', 'AltRight']) assert.equal(keyDown(state('virtual chord cannot start a hold gesture'), code), true, `virtual ${code} is not mistaken for physical host input`);
rmSync(directory, { recursive: true });
console.log(`HOST-SHORTCUTS-PARITY:PASS (${frames.length} shared polls, keyboard and four controller ports)`);
