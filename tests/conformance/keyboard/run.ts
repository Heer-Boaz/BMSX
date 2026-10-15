import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { ON_SCREEN_KEY_DEFINITIONS, ON_SCREEN_KEY_INDEX_BY_CODE } from '../../../hosts/common/input/on_screen_keyboard_keys';
import { keyboardVectors } from './vectors';

type State = {
	page: number; pageCount: number; selected: number; visible: boolean; shift: boolean; revision: number; action: number;
	pressed: number[]; highlighted: number[]; hid: number[]; publishedPage: number; hit: number;
	commands?: Array<Array<string | number | boolean | string[]>>;
};
function run(command: string, args: string[]): string {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
const command = process.argv.slice(2);
if (command.length === 0) {
	run('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON']);
	run('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_keyboard_conformance_runner', '--parallel', '4']);
	command.push('build-cpp-tests/bmsx_keyboard_conformance_runner');
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-keyboard-parity-'));
const vectors = keyboardVectors();
const path = join(directory, 'vectors.txt');
writeFileSync(path, vectors.map(vector => vector.command).join('\n') + '\n');
writeFileSync(join(directory, 'vectors.json'), JSON.stringify(vectors, null, 2));
const ts = run(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.base.json', '--import', './tests/lua/test_setup.ts', 'tests/conformance/keyboard/ts_runner.ts', path]);
writeFileSync(join(directory, 'typescript.jsonl'), ts);
const cpp = run(command[0], [...command.slice(1), path]);
writeFileSync(join(directory, 'cpp.jsonl'), cpp);
const tsRows = ts.trim().split('\n').map(line => JSON.parse(line));
const cppRows = cpp.trim().split('\n').map(line => JSON.parse(line));
assert.equal(tsRows.length, vectors.length, `TS trace length; evidence ${directory}`);
assert.equal(cppRows.length, vectors.length, `C++ trace length; evidence ${directory}`);
for (let index = 0; index < vectors.length; index++) {
	assert.deepEqual(cppRows[index], tsRows[index], `${index}: ${vectors[index].name} (${vectors[index].command}); evidence ${directory}`);
}
// Equivalence alone could let both implementations be wrong; named cases also
// assert the intended held/release and public HID semantics independently.
const state = (name: string): State => {
	const index = vectors.findIndex(vector => vector.name === name);
	assert.notEqual(index, -1, `Missing expected trace case ${name}`);
	return tsRows[index];
};
const key = (code: string) => ON_SCREEN_KEY_INDEX_BY_CODE.get(code);
const q = key('KeyQ'), w = key('KeyW');
for (const [name, selected, other] of [
	['release-plus-A selects and activates W', w, q],
	['stationary release-plus-A selects and activates Q', q, w],
	['dock release-plus-A types Q and moves once', q, w],
] as const) {
	const actual = state(name);
	assert.equal(actual.selected, selected, name);
	assert.equal(actual.pressed[selected], 1, name);
	assert.equal(actual.pressed[other], 0, name);
}
const docked = state('dock release-plus-A types Q and moves once').commands[0];
assert.equal(docked[5], 236, 'docking anchors the panel four pixels above the 240px viewport bottom');
assert.deepEqual(state('dock stays once after release').commands[0], docked, 'the following frame cannot dock a second time');
assert.equal(state('remaining Q reaches HID').pressed[q], 1);
assert.equal(state('released Q reaches HID').pressed[q], 0);
for (const definition of ON_SCREEN_KEY_DEFINITIONS) {
	const usage = hidKeyUsageForCode(definition.code), mask = 1 << (usage & 31);
	assert.notEqual(state(`${definition.code} polled down`).hid[usage >>> 5] & mask, 0, `${definition.code} reaches its canonical HID usage`);
	assert.equal(state(`${definition.code} polled up`).hid[usage >>> 5] & mask, 0, `${definition.code} releases its canonical HID usage`);
}
assert.equal(state('unused Shift tap up').shift, true);
assert.equal(state('one-shot last release').shift, false);
assert.equal(state('used physical Shift release').shift, false);
assert.equal(state('physical transient invalidates sticky completion').shift, false);
assert.equal(state('unused mouse Shift latches on UP').shift, true);
assert.equal(state('typed Q consumes one-shot Shift').shift, false);
assert.equal(state('used mouse Shift UP').shift, false);
assert.equal(state('held mouse and pad remain ineligible').pressed[q], 0);
assert.equal(state('new Q contact after reopen').pressed[q], 1);
assert.equal(state('both controllers A plus B/X').pressed[q], 1);
assert.equal(state('both controllers A plus B/X').pressed[key('Backspace')], 1);
assert.equal(state('both controllers A plus B/X').pressed[key('Space')], 1);
assert.equal(state('controller zero leaves other controller held').pressed[q], 0);
assert.equal(state('controller zero leaves other controller held').pressed[key('Space')], 1);
assert.equal(state('second controller leaves').pressed[key('Space')], 0);
for (const row of tsRows.slice(1)) assert.equal(row.pageCount, tsRows[0].schema.pages.length, 'model page count follows the compared native schema');
const publications = tsRows.filter(row => row.commands !== undefined);
const publicationCount = publications.length;
const commandCount = publications.reduce((count, row) => count + row.commands.length, 0);
for (const publication of publications) for (const command of publication.commands) {
	if (command[0] === 'g') assert.equal(command[11], true, 'every keyboard glyph uses the configured presenter font');
}
rmSync(directory, { recursive: true });
console.log(`KEYBOARD-PARITY:PASS (${vectors.length} shared steps, ${ON_SCREEN_KEY_DEFINITIONS.length} HID keys, ${publicationCount} bitmap publications, ${commandCount} ordered render commands)`);
