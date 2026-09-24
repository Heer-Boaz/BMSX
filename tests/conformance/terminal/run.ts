import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';

function run(command: string, args: string[]): string {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
run('npm', ['run', 'build:toolchain:bios', '--', '--debug', '--force']);
run('npm', ['run', 'build:toolchain:cart', '--', 'hot_resume_test', '--debug', '--force']);
run('cmake', ['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON']);
run('cmake', ['--build', 'build-cpp-tests', '--target', 'bmsx_terminal_conformance_runner', '--parallel', '2']);
const directory = mkdtempSync(join(tmpdir(), 'bmsx-terminal-parity-'));
const events = ['200 0 0 0', '2 0 0 1', '20 0 0 0'];
const commands = [
	'lua print("TERMINAL-BEGIN")',
	'lua 1+2',
	'lua counter=40;return counter,nil,false',
	'lua counter=counter+2;return counter',
	'lua local n=7;fn=function(x)return n+x end',
	'lua fn(5)',
	'lua Value=100;return Value,counter',
	'lua return "MiXeD",counter',
	'lua local transient=9;return transient',
	'lua transient',
	'lua counter=43;print("before error");error("terminal error")',
	'lua counter',
	'lua load("return counter+1")()',
	'lua local x=;',
	'lua print("GLOBALS-BEGIN")',
	'lua getglobal("hot_resume_new_game_count")',
	'lua setglobal("hot_resume_new_game_count",40)',
	'lua getglobal("new_game")();return getglobal("hot_resume_new_game_count")',
	'lua hot_resume_new_game_count',
	'lua object=table.pack(12);setglobal("shared",object)',
	'lua local live=getglobal("shared");live.x=23;return object.x',
	'lua setglobal("fresh",false);return getglobal("fresh")',
	'lua setglobal("fresh");return getglobal("fresh")',
	'lua setglobal("fresh",42);error("global error")',
	'lua getglobal("fresh")',
	'lua getglobal(3)',
	'lua setglobal(false,1)',
	'lua print("TERMINAL-END")',
];
const punctuation: Record<string, [string, boolean]> = {
	' ': ['Space', false], '(': ['Digit9', true], ')': ['Digit0', true],
	'"': ['Quote', true], '=': ['Equal', false], '+': ['Equal', true],
	'-': ['Minus', false], '_': ['Minus', true], '.': ['Period', false], ';': ['Semicolon', false], ',': ['Comma', false],
};
for (const command of commands) {
	assert.ok(command.length <= 76, 'physical BIOS input capacity');
	for (const character of command) {
		let code: string, shifted: boolean;
		if (/[a-zA-Z]/.test(character)) { code = `Key${character.toUpperCase()}`; shifted = character === character.toUpperCase(); }
		else if (/[0-9]/.test(character)) { code = `Digit${character}`; shifted = false; }
		else [code, shifted] = punctuation[character];
		events.push(`2 ${hidKeyUsageForCode(code)} ${shifted ? 1 : 0} 0`, '2 0 0 0');
	}
	events.push(`2 ${hidKeyUsageForCode('Enter')} 0 0`, '20 0 0 0');
}
const input = join(directory, 'input.txt'); writeFileSync(input, events.join('\n'));
try {
	const args = ['dist/bmsx-bios.debug.rom', 'dist/hot_resume_test.debug.rom', input];
	const ts = run('npx', ['tsx', '--tsconfig', 'tsconfig.base.json', 'tests/conformance/terminal/ts_runner.ts', ...args]);
	const cpp = run('build-cpp-tests/bmsx_terminal_conformance_runner', args);
	writeFileSync(join(directory, 'typescript.txt'), ts); writeFileSync(join(directory, 'cpp.txt'), cpp);
	assert.equal(cpp, ts, 'same physical HID input must produce byte-identical firmware Terminal output');
	const result = ts.slice(ts.indexOf('TERMINAL-BEGIN\n'));
	assert.match(result, /^TERMINAL-BEGIN\nnil\n3\n40\tnil\tfalse\n42\nnil\n12\n/);
	assert.match(result, /upper-case identifiers are not allowed/, 'Shift reaches the case-sensitive firmware compiler');
	assert.match(result, /\nMiXeD\t42\n9\nnil\nbefore error\nterminal error\n43\n44\n/);
	assert.match(result, /\[load:/, 'syntax errors are protected by the shared firmware loader');
	assert.match(result, /GLOBALS-BEGIN\nnil\n1\nnil\n41\nnil\nnil\n23\nfalse\nnil\nglobal error\n42\nInvalid argument\.\nInvalid argument\.\n/);
	assert.ok(result.endsWith('TERMINAL-END\nnil\n'), 'syntax error does not kill the physical monitor');
	console.log('TERMINAL-PARITY:PASS (real BIOS monitor, HID input, TypeScript and native C++)');
	rmSync(directory, { recursive: true });
} catch (error) { console.error(`Evidence retained: ${directory}`); throw error; }
