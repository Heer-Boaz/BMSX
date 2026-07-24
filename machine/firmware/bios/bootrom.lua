-- bootrom.lua
-- BMSX system boot firmware

require('bios/base')
require('bios/os')
require('bios/table')
require('bios/string')

math = require('bios/math')
easing = require('bios/easing')

local dma_transfer<const> = require('bios/dma_transfer')
local cartridge<const> = require('system/cartridge')
local gx_gpu<const> = require('system/gx_gpu')
local romdir<const> = require('system/romdir')
local monitor<const> = require('bios/monitor')
local system<const> = require('bios/system')
local terminal<const> = require('bios/terminal')
local terminal_layout<const> = require('bios/terminal_layout')
local vblank<const> = require('bios/vblank')

local irq_mask<const>: *word = 0x08000010
local input_control<const>: *word = 0x0800006c

local cart_rom_magic<const> = 0x58534d42
local cart_rom_base_header_size<const> = 32
local cart_blua32_image_offset<const> = 32
local cart_blua32_startup_offset<const> = 40
local cart_select<const>: *word = cartridge.select_addr
local cart_status<const>: *word = cartridge.status_addr
local irq_vblank<const> = 0x0004
local irq_dma_done<const> = 0x0001
local irq_gpu<const> = 0x0040
local input_arm<const> = 0x00000001
local boot_background<const> = 0xff000040
local cart_state_missing<const> = 1
local cart_state_waiting<const> = 2

bss boot_screen_started: word
bss boot_cart_state: word
bss boot_frame: word
bss boot_cursor_visible: word

function irq(flags)
	system.irq(flags)
end

function exception()
	monitor.enter()
end

local scan_cartridges<const> = function()
	local status<const> = *cart_status
	local cart_present = false
	for slot = 0, 1 do
		if (status & (1 << slot)) ~= 0 then
			cart_present = true
			*cart_select = slot
			if mem[cartridge.rom_base] == cart_rom_magic
				and mem[cartridge.rom_base + 4] >= cart_rom_base_header_size
				and mem[cartridge.rom_base + cart_blua32_image_offset] ~= 0 then
				return cart_present, mem[cartridge.rom_base + cart_blua32_startup_offset]
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
		else
			terminal.write_at(11, 14, 'MISSING', terminal.palette_error)
		end
		*boot_cart_state = cart_state
	end
	*boot_frame = *boot_frame + 1
	local cursor_visible<const> = (*boot_frame & 0x10) == 0 and 1 or 0
	if cursor_visible ~= *boot_cursor_visible then
		terminal.put(17, 4, cursor_visible ~= 0 and 0x7c or 0x20, terminal.palette_accent)
		*boot_cursor_visible = cursor_visible
	end
	terminal.flush()
end

local update_boot_screen<const> = function()
	local cart_present<const>, startup<const> = scan_cartridges()
	if startup ~= nil then
		*irq_mask = 0
		romdir.mount_selected_cartridge()
		print('Cart boot requested.')
		cop0.exec = startup
	end
	update_boot_output(cart_present)
end

function init()
	*irq_mask = irq_dma_done | irq_gpu
	gx_gpu.reset_256x192()
	gx_gpu.display_origin(terminal_layout.vram_origin)
	gx_gpu.draw_target(terminal_layout.vram_origin)
	gx_gpu.clear_color(boot_background)
	local system_texture<const> = romdir.resource('gx_system_texture')
	dma_transfer.copy_to_gp0(system_texture.addr, system_texture.len >> 2)
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
