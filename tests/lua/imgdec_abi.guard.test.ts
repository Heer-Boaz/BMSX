import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
	IMG_CTRL_START,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
} from '../../machine/ts/machine/bus/io';

function luaConst(source: string, name: string): number {
	const match = source.match(new RegExp(`local ${name}<const> = (0x[0-9a-f]+|[0-9]+)`))!;
	return Number(match[1]);
}

test('IMGDEC Lua ABI constants are firmware-owned, not host-seeded globals', () => {
	const tsGlobals = readFileSync('machine/ts/machine/firmware/globals.ts', 'utf8');
	const cppGlobals = readFileSync('machine/cpp/machine/firmware/system_globals.cpp', 'utf8');
	const descriptors = readFileSync('machine/ts/machine/firmware/builtin_descriptors.ts', 'utf8');
	const systemGlobals = readFileSync('machine/ts/machine/firmware/system_globals.ts', 'utf8');
	for (const source of [tsGlobals, cppGlobals, descriptors, systemGlobals]) {
		assert.equal(source.includes('sys_img_'), false);
		assert.equal(source.includes('img_status_'), false);
		assert.equal(source.includes('img_ctrl_start'), false);
	}
});

test('IMGDEC firmware constants match the hardware register words', () => {
	const source = readFileSync('machine/firmware/system/imgdec.lua', 'utf8');
	assert.equal(luaConst(source, 'sys_img_src'), IO_IMG_SRC);
	assert.equal(luaConst(source, 'sys_img_len'), IO_IMG_LEN);
	assert.equal(luaConst(source, 'sys_img_dst'), IO_IMG_DST);
	assert.equal(luaConst(source, 'sys_img_cap'), IO_IMG_CAP);
	assert.equal(luaConst(source, 'sys_img_ctrl'), IO_IMG_CTRL);
	assert.equal(luaConst(source, 'img_ctrl_start'), IMG_CTRL_START);
});
