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
	'lua print("CART-BEGIN")',
	'lua counter',
	'lua hot_resume_new_game_count',
	'lua hot_resume_new_game_count=50;return hot_resume_new_game_count',
	'lua new_game();return hot_resume_new_game_count',
	'lua counter=80;return counter',
	'lua --session counter',
	'lua load("return counter+1")()',
	'lua local counter=7;return counter',
	'lua counter',
	'lua native_fn=function(x)return counter+x end',
	'lua native_fn(5)',
	'lua counter=90;return native_fn(5)',
	'lua counter=91;error("cart error")',
	'lua counter',
	'lua print("TUPLES-BEGIN")',
	'lua fn=function()return 7,nil,false,9,nil end',
	'lua fn()',
	'lua return 1,fn()',
	'lua return (fn())',
	'lua return select("#",fn())',
	'lua return select("#",1,fn())',
	'lua return pcall(fn)',
	'lua local x=table.pack(select(2,7));return x.n',
	'lua return string.find("abcd","bc")',
	'lua print("FRAMES-BEGIN")',
	'frames',
	'lua --frame 0 0 vblank_count=37;return vblank_count,nil,false',
	'lua --frame 0 0 vblank_count=38;error("frame error")',
	'lua --frame 0 0 return vblank_count',
	'lua --frame 0 999 return vblank_count',
	'lua --frame 999 0 return 999',
	'lua print("TERMINAL-END")',
];
// Earlier cases exercise the explicitly isolated session; the same physical
// monitor also exercises implicit globals without adding a host evaluator.
for (let index = 0; index < commands.indexOf('lua print("GLOBALS-BEGIN")'); index++) {
	commands[index] = commands[index].replace('lua ', 'lua --session ');
}
commands[commands.indexOf('lua hot_resume_new_game_count')] = 'lua --session hot_resume_new_game_count';
const punctuation: Record<string, [string, boolean]> = {
	' ': ['Space', false], '(': ['Digit9', true], ')': ['Digit0', true],
	'"': ['Quote', true], '=': ['Equal', false], '+': ['Equal', true],
	'#': ['Digit3', true],
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
	// setglobal has no results; expression evaluation must not manufacture nil.
	assert.match(result, /GLOBALS-BEGIN\nnil\n1\n41\nnil\nnil\n23\nfalse\nnil\nglobal error\n42\nInvalid argument\.\nInvalid argument\.\n/);
	assert.match(result, /CART-BEGIN\nnil\nnil\n41\n50\n51\n80\n43\n81\n7\n80\nnil\n85\n95\ncart error\n91\n/);
	assert.match(result, /TUPLES-BEGIN\nnil\nnil\n7\tnil\tfalse\t9\tnil\n1\t7\tnil\tfalse\t9\tnil\n7\n5\n6\ntrue\t7\tnil\tfalse\t9\tnil\n0\n2\t3\n/);
	assert.match(result, /37\tnil\tfalse\nframe error\n38\nFrame source scope is unavailable/, 'selected native frame writes and pre-error side effects are real');
	assert.ok(result.endsWith('TERMINAL-END\nnil\n'), 'syntax error does not kill the physical monitor');
	console.log('TERMINAL-PARITY:PASS (real BIOS monitor, HID input, TypeScript and native C++)');
	rmSync(directory, { recursive: true });
} catch (error) { console.error(`Evidence retained: ${directory}`); throw error; }
