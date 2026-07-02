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

test('IMGDEC hardware words are raw firmware words, not host-seeded globals', () => {
	const tsGlobals = readFileSync('machine/ts/machine/firmware/globals.ts', 'utf8');
	const cppGlobals = readFileSync('machine/cpp/machine/firmware/globals.cpp', 'utf8');
	const descriptors = readFileSync('machine/ts/machine/firmware/builtin_descriptors.ts', 'utf8');
	const systemBootSymbols = readFileSync('machine/ts/machine/firmware/system_boot_symbols.ts', 'utf8');
	for (const source of [tsGlobals, cppGlobals, descriptors, systemBootSymbols]) {
		assert.equal(source.includes('sys_img_'), false);
		assert.equal(source.includes('img_status_'), false);
		assert.equal(source.includes('img_ctrl_start'), false);
	}
});

test('IMGDEC firmware consumes raw hardware words directly', () => {
	const source = readFileSync('machine/firmware/system/imgdec.lua', 'utf8');
	const imgCtrl = `0x${IO_IMG_CTRL.toString(16).padStart(8, '0')}`;
	assert.equal(source.includes('sys_img_'), false);
	assert.equal(source.includes('img_ctrl_start'), false);
	assert.equal(source.includes('require('), false);
	assert.equal(source.includes(`mem[${imgCtrl}] = 0x${IMG_CTRL_START.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`mem[0x${IO_IMG_SRC.toString(16).padStart(8, '0')}] = src`), true);
	assert.equal(source.includes(`mem[0x${IO_IMG_LEN.toString(16).padStart(8, '0')}] = len`), true);
	assert.equal(source.includes(`mem[0x${IO_IMG_DST.toString(16).padStart(8, '0')}] = dst`), true);
	assert.equal(source.includes(`mem[0x${IO_IMG_CAP.toString(16).padStart(8, '0')}] = cap`), true);
});
