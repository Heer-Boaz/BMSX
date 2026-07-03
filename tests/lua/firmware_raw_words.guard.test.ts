import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
	IMG_CTRL_START,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_INP_CTRL,
	IO_IRQ_MASK,
	IO_SYS_CYCLES_PER_FRAME,
	IO_VDP_FIFO,
	IO_VDP_MODE,
	IO_VDP_SCREEN_WH,
	IO_VDP_STATUS,
} from '../../machine/ts/machine/bus/io';
import {
	getMachineVdpModeProfile,
	PSX_MODEL_PROFILE,
	PSX_VRAM_STAGING_BYTES,
	PSX_VRAM_TEXTURE_BYTES,
} from '../../machine/ts/machine/model_registry';
import { RPU_QUAD_SURFACE_DESC_COUNT } from '../../scripts/rompacker/texture_atlas_contract';

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

test('bootrom handoff waits for VDP submit idle before leaving system firmware', () => {
	const source = readFileSync('machine/firmware/bios/bootrom.lua', 'utf8');
	const biosVdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	const bootVramTotal = PSX_VRAM_STAGING_BYTES
		+ PSX_VRAM_TEXTURE_BYTES
		+ biosVdpMode.renderWidth * biosVdpMode.renderHeight * 4;
	assert.equal(source.includes('boot_requested'), false);
	assert.equal(source.includes('sys_boot_cart'), false);
	assert.equal(source.includes(`local vram_total<const> = 0x${bootVramTotal.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`mem[0x${IO_VDP_MODE.toString(16).padStart(8, '0')}] = 0x00000002`), true);
	assert.equal(source.includes(`local irq_mask_addr<const> = 0x${IO_IRQ_MASK.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`hw_max_cycles = format_bignumbers(mem[0x${IO_SYS_CYCLES_PER_FRAME.toString(16).padStart(8, '0')}])`), true);
	assert.equal(source.includes(`local screen_wh<const> = mem[0x${IO_VDP_SCREEN_WH.toString(16).padStart(8, '0')}]`), true);
	assert.equal(source.includes(`if (mem[0x${IO_VDP_STATUS.toString(16).padStart(8, '0')}] & 0x00000002) ~= 0 then\n\t\t\treturn false\n\t\tend\n\t\tprint('Cart boot requested.')\n\t\tmem[irq_mask_addr] = 0\n\t\treturn true`), true);
	assert.equal(source.includes(`mem[0x${IO_INP_CTRL.toString(16).padStart(8, '0')}] = 0x00000001`), true);
	assert.equal(source.includes(`mem[0x${IO_DMA_SRC.toString(16).padStart(8, '0')}] = 0x080c0000`), true);
	assert.equal(source.includes(`mem[0x${IO_DMA_DST.toString(16).padStart(8, '0')}] = 0x${IO_VDP_FIFO.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`mem[0x${IO_DMA_LEN.toString(16).padStart(8, '0')}] = used_bytes`), true);
	assert.equal(source.includes(`mem[0x${IO_DMA_CTRL.toString(16).padStart(8, '0')}] = 0x00000001`), true);
});

test('RPU quad firmware descriptor table matches the rompacker texture contract', () => {
	const source = readFileSync('machine/firmware/system/vdp_rpu_quads.lua', 'utf8');
	assert.equal(source.includes(`local surface_desc_count<const> = ${RPU_QUAD_SURFACE_DESC_COUNT}`), true);
});
