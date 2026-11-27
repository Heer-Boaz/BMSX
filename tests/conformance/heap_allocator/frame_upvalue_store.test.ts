import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { runSystemCaseRom } from '../../helpers/system_case_rom';
import { BASE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';

const source = `
require('base')
local create<const> = require('kernel/thread_create').create_coroutine
local store<const> = require('kernel/frame_upvalue').set_frame_upvalue
local resume<const> = __bmsx_coroutine_resume
local yield<const> = __bmsx_coroutine_yield
local read<const> = __bmsx_get_frame_upvalue
local protected<const> = __bmsx_pcall
local raise<const> = __bmsx_error
local assert<const> = function(condition)
 if not condition then raise('unexpected frame capture') end
end
local function closed_thread(seed)
 local captured = seed
 return create(function()
  local first = captured
  yield(first)
  return captured
 end)
end
local closed = closed_thread(41)
local ok, value = resume(closed)
assert(ok and value == 41 and read(closed, 0, 0) == 41)
store(closed, 0.0, 0.0, nil)
assert(read(closed, 0, 0) == nil)
local replacement = { value = 53 }
assert(select('#', store(closed, 0, 0, replacement)) == 0)
local accepted, message = protected(store, closed, 0, 0.5, nil)
assert(not accepted and message == 'Invalid argument.')
accepted, message = protected(store, closed, 0, 0x100000, nil)
assert(not accepted and message == 'Invalid argument.')
accepted, message = protected(store, 99, 0, 0, nil)
assert(not accepted and message == 'Invalid argument.')
ok, value = resume(closed)
assert(ok and value == replacement)

local captured = 72
local function bump()
 captured = captured + 1
end
bump()
local open = create(function()
 local first = captured
 yield(first)
 return captured
end)
ok, value = resume(open)
assert(ok and value == 73 and read(open, 0, 0) == 73)
store(open, 0, 0, replacement)
assert(read(open, 0, 0) == replacement)
ok, value = resume(open)
assert(ok and value == replacement)
return true, true
`;

test('firmware writes the selected suspended Frame capture in its closed cell or owning stack', () => {
	mkdirSync('tmp', { recursive: true });
	const dir = mkdtempSync(join('tmp', 'frame-upvalue-store-'));
	try {
		const native = nativeConformanceRunner('bmsx_frame_evaluation_runner');
		for (const level of [0, 3] as const) {
			const rom = writeTestBlua32Rom(linkManagedTestSystem(source, level,
				[...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: 'return {}' }]));
			const path = join(dir, `O${level}.rom`);
			writeFileSync(path, rom);
			assert.equal(runSystemCaseRom(rom, () => assert.fail('fixture has no external suspension')), 0);
			assert.equal(execFileSync(native, [path, 'run'], { encoding: 'utf8' }).trim(), '0');
		}
	} finally {
		rmSync(dir, { recursive: true });
	}
});
