module<entry>
-- bootrom.lua
-- BMSX system boot firmware

require('bios/base')
table = require('bios/table')
string = require('bios/string')
os = require('bios/os')

math = require('bios/math')

local dma_transfer<const> = require('bios/dma_transfer')
local gx_gpu<const> = require('system/gx_gpu')
local assets<const> = require('bmsx/system_assets')
local monitor<const> = require('bios/monitor')
local system<const> = require('bios/system')
local terminal<const> = require('bios/terminal')
local terminal_layout<const> = require('bios/terminal_layout')
local vblank<const> = require('bios/vblank')

local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064

local cart_rom_magic<const> = 0x58534d42
local cart_rom_base_header_size<const> = 32
local cart_blua32_image_offset<const> = 32
local cart_blua32_startup_offset<const> = 40
local cart_select<const>: *word = 0x0801041c
local cart_status<const>: *word = 0x08010420
local cart_rom_base<const> = 0x10000000
local irq_vblank<const> = 0x0004
local irq_dma_done<const> = 0x0001
local irq_gpu<const> = 0x0040
local input_arm<const> = 0x00000001
local boot_background<const> = 0xff000040
local cart_state_missing<const> = 1
local cart_state_waiting<const> = 2
local boot_delay_frames<const> = 50
local ascii_zero<const> = 0x30

bss boot_screen_started: word
bss boot_cart_state: word
bss boot_frame: word
bss boot_cursor_visible: word

function irq(flags)
	system.irq(flags)
end

function exception(error_value)
	monitor.enter(error_value)
end

local scan_cartridges<const> = function()
	local status<const> = *cart_status
	local cart_present = false
	for slot = 0, 1 do
		if (status & (1 << slot)) ~= 0 then
			cart_present = true
			*cart_select = slot
			if mem[cart_rom_base] == cart_rom_magic
				and mem[cart_rom_base + 4] >= cart_rom_base_header_size
				and mem[cart_rom_base + cart_blua32_image_offset] ~= 0 then
				return cart_present, mem[cart_rom_base + cart_blua32_startup_offset]
			end
		end
	end
	return cart_present, nil
end

local initialize_boot_output<const> = function()
	terminal.open()
	terminal.write_at(2, 4, 'BMSX SYSTEM BIOS', terminal.palette_accent)
	terminal.write_at(4, 4, 'SYSTEM', terminal.palette_accent)
	terminal.write_at(5, 4, 'CPU       BLUA32', terminal.palette_text)
	terminal.write_at(6, 4, 'RAM       4096 KB', terminal.palette_text)
	terminal.write_at(7, 4, 'VRAM      2048 KB', terminal.palette_text)
	terminal.write_at(8, 4, 'VIDEO     256x192 50HZ', terminal.palette_text)
	terminal.write_at(10, 4, 'CARTRIDGE', terminal.palette_accent)
	terminal.write_at(11, 4, 'ROM       ', terminal.palette_text)
	terminal.write_at(12, 4, 'BLUA32    WAITING', terminal.palette_text)
	terminal.write_at(14, 4, 'BOOT', terminal.palette_accent)
	terminal.write_at(15, 4, 'WAITING FOR CARTRIDGE', terminal.palette_text)
	*boot_screen_started = 1
	*boot_cart_state = 0
	*boot_frame = 0
	*boot_cursor_visible = 0
end

local update_boot_output<const> = function(cart_present)
	if *boot_screen_started == 0 then
		initialize_boot_output()
	end
	local cart_state<const> = cart_present and cart_state_waiting or cart_state_missing
	if cart_state ~= *boot_cart_state then
		if cart_state == cart_state_waiting then
			terminal.write_at(11, 14, 'FOUND  ', terminal.palette_text)
			terminal.write_at(15, 4, 'BOOTING IN 0.0S      ', terminal.palette_text)
			*boot_frame = 0
		else
			terminal.write_at(11, 14, 'MISSING', terminal.palette_error)
			terminal.write_at(15, 4, 'WAITING FOR CARTRIDGE', terminal.palette_text)
		end
		*boot_cart_state = cart_state
	end
	*boot_frame = *boot_frame + 1
	if cart_state == cart_state_waiting then
		local remaining_frames = boot_delay_frames - *boot_frame
		if remaining_frames < 0 then
			remaining_frames = 0
		end
		local remaining_tenths<const> = (remaining_frames + 4) // 5
		terminal.put(15, 15, ascii_zero + remaining_tenths // 10, terminal.palette_text)
		terminal.put(15, 17, ascii_zero + remaining_tenths % 10, terminal.palette_text)
	end
	local cursor_visible<const> = (*boot_frame & 0x10) == 0 and 1 or 0
	if cursor_visible ~= *boot_cursor_visible then
		terminal.put(17, 4, cursor_visible ~= 0 and 0x7c or 0x20, terminal.palette_accent)
		*boot_cursor_visible = cursor_visible
	end
	terminal.flush()
end

local update_boot_screen<const> = function()
	local cart_present<const>, startup<const> = scan_cartridges()
	local cart_countdown_active<const> = *boot_cart_state == cart_state_waiting
	update_boot_output(cart_present)
	if startup and cart_countdown_active and *boot_frame >= boot_delay_frames then
		*irq_mask = 0
		print('Cart boot requested.')
		cop0.exec = startup
	end
end

function init()
	*irq_mask = irq_dma_done | irq_gpu
	gx_gpu.reset_256x192()
	gx_gpu.display_origin(terminal_layout.vram_origin)
	gx_gpu.draw_target(terminal_layout.vram_origin)
	gx_gpu.clear_color(boot_background)
	dma_transfer.copy_to_gp0(assets.bin_gx_system_texture_addr, assets.bin_gx_system_texture_len >> 2)
end

function new_game()
end

init()
*irq_mask = irq_dma_done | irq_vblank | irq_gpu
new_game()
*input_control = input_arm
while true do
	vblank.wait()
	update_boot_screen()
	*input_control = input_arm
end
