local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240_pal()
require('cartlib/prelude')

local gp1_status<const>: *word = 0x08010244
local irq_mask_register<const>: *word = 0x08000010
local input_control_register<const>: *word = 0x0800006c

local irq_vblank<const> = 0x0004
local irq_apu<const> = 0x0020

local target<const> = 50
local vblank_count = 0
local fail_reason = nil
local done = false

local gpustat_interlace_field<const> = 0x00002000
local gpustat_pal_mode<const> = 0x00100000
local gpustat_display_disabled<const> = 0x00800000
local gpustat_ready_command<const> = 0x04000000
local gpustat_ready_dma<const> = 0x10000000
local gpustat_dma_direction_mask<const> = 0x60000000

vblank_test_irq_count = 0
vblank_test_update_count = 0
vblank_test_last_gpustat = 0
vblank_test_passed = false
vblank_test_fail_reason = nil

local fail<const> = function(msg)
	if fail_reason == nil then
		fail_reason = msg
		vblank_test_fail_reason = msg
	end
end

local record_gpustat<const> = function()
	local status<const> = *gp1_status
	vblank_test_last_gpustat = status
	return status
end

local check_gpustat<const> = function(label)
	local status<const> = record_gpustat()
	if (status & gpustat_pal_mode) == 0 then
		fail(label .. ': GPUSTAT PAL bit clear')
	end
	if (status & gpustat_display_disabled) ~= 0 then
		fail(label .. ': GPUSTAT display disabled')
	end
	if (status & gpustat_ready_command) == 0 then
		fail(label .. ': GPUSTAT command port not ready')
	end
	if (status & gpustat_ready_dma) == 0 then
		fail(label .. ': GPUSTAT DMA receive bit clear')
	end
	if (status & gpustat_dma_direction_mask) ~= 0 then
		fail(label .. ': GPUSTAT DMA direction not off')
	end
	return status
end

function init()
	local status<const> = check_gpustat('init')
	if (status & gpustat_interlace_field) == 0 then
		fail('init: GPUSTAT interlace field bit clear in progressive mode')
	end
end

function new_game()
end

local update_cart<const> = function()
	vblank_test_update_count = vblank_test_update_count + 1
	if done then
		return
	end
	if fail_reason ~= nil then
		print("VBLANK TEST FAIL: " .. fail_reason .. " (irqs=" .. vblank_count .. " gpustat=" .. tostring(vblank_test_last_gpustat) .. ")")
		done = true
		return
	end
	if vblank_count >= target then
		print("VBLANK TEST PASS: " .. vblank_count .. " IRQs GPUSTAT=" .. tostring(vblank_test_last_gpustat))
		done = true
	end
end

local draw_cart<const> = function()
	local progress<const> = vblank_count % 60
	local bar_width<const> = 16 + progress * 4
	local pulse<const> = (vblank_count * 5) & 0x000000ff
	gx_clear_color(0xff081018)
	gx_fill_rect_color(16, 24, 304, 56, 0xff102840)
	gx_fill_rect_color(16, 24, 16 + bar_width, 56, 0xff20f0a0)
	gx_draw_line_color(16, 72 + (progress >> 1), 304, 72, 0xffffd060)
	gx_fill_rect_color(24, 104, 296, 136, 0xff202020 | (pulse << 8))
end

local on_vblank_irq<const> = function(_, flags)
	if (flags & irq_vblank) ~= 0 then
		vblank_count = vblank_count + 1
		vblank_test_irq_count = vblank_count
		check_gpustat('vblank_irq')
		if vblank_count >= target then
			vblank_test_passed = true
		end
		*input_control_register = 0x00000001
		update_cart()
		draw_cart()
	end
end

init()
on_irq(irq_vblank, on_vblank_irq)
*irq_mask_register = irq_vblank | irq_apu
new_game()
*input_control_register = 0x00000001
while true do
	halt_until_irq
end
