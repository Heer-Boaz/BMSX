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
	IO_GX_GPU_GP0,
	IO_GX_GPU_GP1,
	IO_INP_CTRL,
	IO_IRQ_MASK,
	IO_SYS_CYCLES_PER_FRAME,
} from '../../machine/ts/machine/bus/io';
import {
	PSX_GPU_DISPLAY_SIZE_SPEC,
	PSX_VRAM_STAGING_BYTES,
	PSX_VRAM_TEXTURE_BYTES,
} from '../../machine/ts/machine/model_registry';
import { RPU_QUAD_SURFACE_DESC_COUNT } from '../../scripts/rompacker/texture_atlas_contract';

test('IMGDEC hardware words are raw firmware words, not host-seeded globals', () => {
	const tsGlobals = readFileSync('machine/ts/machine/firmware/globals.ts', 'utf8');
	const cppGlobals = readFileSync('machine/cpp/machine/firmware/globals.cpp', 'utf8');
	const descriptors = readFileSync('machine/ts/lua/builtin_descriptors.ts', 'utf8');
	const systemBootSymbols = readFileSync('machine/ts/lua/compiler/system_boot_symbols.ts', 'utf8');
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

test('bootrom handoff uses GX GPU output instead of VDP stream submit', () => {
	const source = readFileSync('machine/firmware/bios/bootrom.lua', 'utf8');
	const gpuDisplaySize = PSX_GPU_DISPLAY_SIZE_SPEC;
	const bootVramTotal = PSX_VRAM_STAGING_BYTES
		+ PSX_VRAM_TEXTURE_BYTES
		+ gpuDisplaySize.renderWidth * gpuDisplaySize.renderHeight * 4;
	assert.equal(source.includes('boot_requested'), false);
	assert.equal(source.includes('sys_boot_cart'), false);
	assert.equal(source.includes(`local vram_total<const> = 0x${bootVramTotal.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`local irq_mask_addr<const> = 0x${IO_IRQ_MASK.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`hw_max_cycles = format_bignumbers(mem[0x${IO_SYS_CYCLES_PER_FRAME.toString(16).padStart(8, '0')}])`), true);
	assert.equal(source.includes(`mem[0x${IO_INP_CTRL.toString(16).padStart(8, '0')}] = 0x00000001`), true);
	assert.equal(source.includes('gx_gpu.reset_320x240_pal()'), true);
	assert.equal(source.includes('gx_image.load_atlas(254)'), true);
	assert.equal(source.includes('gx_image.upload_atlas(254)'), true);
	assert.equal(source.includes('gx_gpu.clear_color(color_bg)'), true);
	assert.equal(source.includes('gx_gpu.fill_rect_color(0, 0, width, 24, color_header_bg)'), true);
	assert.equal(source.includes('gx_image.blit_img_color(glyph.imgid, cursor_x, y, color)'), true);
	assert.equal(source.includes('vdp_'), false);
	assert.equal(source.includes('0x0800007c'), false);
	assert.equal(source.includes('0x08000144'), false);
	assert.equal(source.includes('vdp_stream_cursor'), false);
});

test('RPU quad firmware descriptor table matches the rompacker texture contract', () => {
	const source = readFileSync('machine/firmware/system/vdp_rpu_quads.lua', 'utf8');
	assert.equal(source.includes(`local surface_desc_count<const> = ${RPU_QUAD_SURFACE_DESC_COUNT}`), true);
});

test('VDP image firmware uses numeric ROMDIR atlas ids', () => {
	const vdpImageSource = readFileSync('machine/firmware/system/vdp_image.lua', 'utf8');
	const romdirSource = readFileSync('machine/firmware/system/romdir.lua', 'utf8');
	const cartlibSystemSource = readFileSync('cartlib/system.lua', 'utf8');
	const cartlibPreludeSource = readFileSync('cartlib/prelude.lua', 'utf8');
	assert.equal(vdpImageSource.includes("string.format('_atlas_"), false);
	assert.equal(vdpImageSource.includes('romdir.cart_atlas(atlas_id)'), true);
	assert.equal(vdpImageSource.includes('romdir.atlas(atlas_id)'), true);
	assert.equal(romdirSource.includes('rom.atlases[atlas_id_from_name(entry.id)] = entry'), true);
	assert.equal(cartlibSystemSource.includes('vdp_load_system_atlas'), false);
	assert.equal(cartlibPreludeSource.includes('vdp_load_system_atlas'), false);
});


test('GX image firmware maps decoded RGBA atlases into direct16 PSX texture pages', () => {
	const gxImageSource = readFileSync('machine/firmware/system/gx_image.lua', 'utf8');
	const cartlibSystemSource = readFileSync('cartlib/system.lua', 'utf8');
	const cartlibPreludeSource = readFileSync('cartlib/prelude.lua', 'utf8');
	const firmwareFontSource = readFileSync('machine/firmware/system/font.lua', 'utf8');
	const cartlibFontSource = readFileSync('cartlib/font.lua', 'utf8');
	assert.equal(gxImageSource.includes("require('system/gx_gpu')"), true);
	assert.equal(gxImageSource.includes('gpu_texture_base_y<const> = 256'), true);
	assert.equal(gxImageSource.includes('gpu_texture_slice_width<const> = 1024'), true);
	assert.equal(gxImageSource.includes('imgdec.start(atlas.addr, atlas.len, atlas_meta.texture_addr, atlas_meta.texture_len)'), true);
	assert.equal(gxImageSource.includes('gx_gpu.upload_rgba8888_to_direct16_stride'), true);
	assert.equal(gxImageSource.includes('gx_gpu.draw_direct16_textured_rect_color'), true);
	assert.equal(cartlibSystemSource.includes('system.gx_load_atlas = gx_image.load_atlas'), true);
	assert.equal(cartlibSystemSource.includes('system.gx_upload_atlas = gx_image.upload_atlas'), true);
	assert.equal(cartlibSystemSource.includes('system.gx_blit_img_color = gx_image.blit_img_color'), true);
	assert.equal(cartlibPreludeSource.includes('gx_blit_img_color = system.gx_blit_img_color'), true);
	assert.equal(firmwareFontSource.includes("require('system/gx_image')"), true);
	assert.equal(firmwareFontSource.includes("require('system/vdp_image')"), false);
	assert.equal(cartlibFontSource.includes("require('system/gx_image')"), true);
	assert.equal(cartlibFontSource.includes("require('system/vdp_image')"), false);
});

test('GX GPU firmware owns raw PSX GP0 and GP1 words for migrated primitive carts', () => {
	const gxGpuSource = readFileSync('machine/firmware/system/gx_gpu.lua', 'utf8');
	const renderHwTestSource = readFileSync('carts/renderhwtest/entry.lua', 'utf8');
	assert.equal(gxGpuSource.includes(`local gp0<const>: *word = 0x${IO_GX_GPU_GP0.toString(16).padStart(8, '0')}`), true);
	assert.equal(gxGpuSource.includes(`local gp1<const>: *word = 0x${IO_GX_GPU_GP1.toString(16).padStart(8, '0')}`), true);
	assert.equal(gxGpuSource.includes('gp0_draw_rectangle'), true);
	assert.equal(gxGpuSource.includes('gp0_draw_semitransparent_rectangle'), true);
	assert.equal(gxGpuSource.includes('gp0_draw_mode'), true);
	assert.equal(gxGpuSource.includes('draw_mode_blend_quarter'), true);
	assert.equal(gxGpuSource.includes('gp0_cpu_to_vram'), true);
	assert.equal(gxGpuSource.includes('gp0_draw_raw_textured_rectangle'), true);
	assert.equal(gxGpuSource.includes('upload_rgba8888_to_direct16_stride'), true);
	assert.equal(gxGpuSource.includes('draw_direct16_textured_rect_color'), true);
	assert.equal(gxGpuSource.includes('gp0_draw_line'), true);
	assert.equal(renderHwTestSource.includes('gx_reset_320x240_pal()'), true);
	assert.equal(renderHwTestSource.includes('vdp_'), false);
	assert.equal(renderHwTestSource.includes('0x0800007c'), false);
});

test('fade probe cart uses GX semi-transparent rectangles instead of VDP streams', () => {
	const fadeProbeSource = readFileSync('carts/fade_probe/entry.lua', 'utf8');
	assert.equal(fadeProbeSource.includes('gx_reset_320x240_pal()'), true);
	assert.equal(fadeProbeSource.includes('gx_set_draw_mode'), true);
	assert.equal(fadeProbeSource.includes('gx_draw_mode_blend_quarter'), true);
	assert.equal(fadeProbeSource.includes('gx_fill_rect_semitrans_color'), true);
	assert.equal(fadeProbeSource.includes('vdp_'), false);
	assert.equal(fadeProbeSource.includes('0x0800007c'), false);
});


test('empty cart uses GX output instead of VDP streams', () => {
	const emptyCartSource = readFileSync('carts/emptycart/entry.lua', 'utf8');
	assert.equal(emptyCartSource.includes('gx_reset_320x240_pal()'), true);
	assert.equal(emptyCartSource.includes('gx_clear_color'), true);
	assert.equal(emptyCartSource.includes('vdp_'), false);
	assert.equal(emptyCartSource.includes('0x0800007c'), false);
	assert.equal(emptyCartSource.includes('0x08000084'), false);
});

test('vblank test cart samples PSX GPUSTAT through GX GP1 instead of VDP status', () => {
	const source = readFileSync('carts/vblanktest/entry.lua', 'utf8');
	assert.equal(source.includes(`local gp1_status<const>: *word = 0x${IO_GX_GPU_GP1.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`local irq_mask_register<const>: *word = 0x${IO_IRQ_MASK.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes(`local input_control_register<const>: *word = 0x${IO_INP_CTRL.toString(16).padStart(8, '0')}`), true);
	assert.equal(source.includes('*gp1_status'), true);
	assert.equal(source.includes('gpustat_pal_mode'), true);
	assert.equal(source.includes('gpustat_display_disabled'), true);
	assert.equal(source.includes('gpustat_ready_command'), true);
	assert.equal(source.includes('gx_reset_320x240_pal()'), true);
	assert.equal(source.includes('gx_fill_rect_color'), true);
	assert.equal(source.includes('vdp_'), false);
	assert.equal(source.includes('0x08000144'), false);
	assert.equal(source.includes('0x0800007c'), false);
	assert.equal(source.includes('0x08000084'), false);
	assert.equal(source.includes('vdp_stream_cursor'), false);
	assert.equal(source.includes('vdp_stream_finish'), false);
});
