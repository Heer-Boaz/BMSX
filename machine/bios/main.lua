module<entry>
-- BMSX system boot firmware

require('base')
table = require('table')
string = require('string')
os = require('os')

math = require('math')

local dma_transfer<const> = require('kernel/dma')
local gx_gpu<const> = require('gpu/gpu')
local assets<const> = require('bmsx/system_assets')
local interrupts<const> = require('kernel/interrupts')
local monitor<const> = require('shell/monitor')
local terminal<const> = require('tty/terminal')
local terminal_layout<const> = require('tty/layout')
local vblank<const> = require('kernel/vblank')

local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064

local cart_rom_magic<const> = 0x58534d42
local cart_rom_boot_header_size<const> = 60
local cart_blua32_image_offset<const> = 32
local cart_blua32_startup_offset<const> = 40
local cart_select<const>: *word = 0x0801041c
local cart_status<const>: *word = 0x08010420
local cart_rom_base<const> = 0x10000000
local irq_vblank<const> = 0x0004
local irq_dma_done<const> = 0x0001
local irq_gpu<const> = 0x0040
local input_arm<const> = 0x00000001
local cart_state_missing<const> = 1
local cart_state_invalid<const> = 2
local cart_state_ready<const> = 3
local boot_delay_frames<const> = 50
local boot_countdown_frames_per_tenth<const> = 5
local ascii_zero<const> = 0x30

bss boot_cart_state: word
bss boot_frame: word

function irq(flags)
	interrupts.dispatch(flags)
end

function exception(error_value)
	monitor.enter(error_value)
end

local scan_cartridges<const> = function()
	local status<const> = *cart_status
	local state = cart_state_missing
	for slot = 0, 1 do
		if (status & (1 << slot)) ~= 0 then
			state = cart_state_invalid
			*cart_select = slot
			if mem[cart_rom_base] == cart_rom_magic
				and mem[cart_rom_base + 4] >= cart_rom_boot_header_size
				and mem[cart_rom_base + cart_blua32_image_offset] ~= 0
				and mem[cart_rom_base + cart_blua32_startup_offset] ~= 0 then
				return cart_state_ready, mem[cart_rom_base + cart_blua32_startup_offset]
			end
		end
	end
	return state, 0
end

local initialize_boot_output<const> = function()
	terminal.open()
	print('BMSX SYSTEM ROM')
	print('CPU       BLUA32')
	print('VIDEO     320X240 50HZ')
	terminal.drain_print_output(terminal.palette_text)
	*boot_cart_state = 0
	*boot_frame = 0
end

local update_boot_output<const> = function(cart_state)
	if cart_state == *boot_cart_state then
		return
	end
	*boot_cart_state = cart_state
	*boot_frame = 0
	if cart_state == cart_state_missing then
		print('CARTRIDGE MISSING')
		terminal.show_status('WAITING FOR CARTRIDGE', terminal.palette_accent)
	elseif cart_state == cart_state_invalid then
		print('CARTRIDGE NOT BOOTABLE')
		terminal.show_status('CARTRIDGE NOT BOOTABLE', terminal.palette_error)
	else
		print('CARTRIDGE READY')
		terminal.show_status('BOOTING IN 1.0S', terminal.palette_accent)
	end
	terminal.drain_print_output(terminal.palette_text)
end

local update_boot_screen<const> = function()
	local cart_state<const>, startup<const> = scan_cartridges()
	update_boot_output(cart_state)
	if cart_state == cart_state_ready and *boot_frame >= boot_delay_frames then
		terminal.clear_status()
		terminal.flush()
		*irq_mask = 0
		cop0.exec = startup
		return
	end
	if cart_state == cart_state_ready then
		if (*boot_frame % boot_countdown_frames_per_tenth) == 0 then
			local remaining_tenths<const> = (boot_delay_frames - *boot_frame) // boot_countdown_frames_per_tenth
			terminal.put_status(11, ascii_zero + remaining_tenths // 10, terminal.palette_accent)
			terminal.put_status(13, ascii_zero + remaining_tenths % 10, terminal.palette_accent)
		end
		*boot_frame = *boot_frame + 1
	end
	terminal.flush()
end

local init<const> = function()
	*irq_mask = irq_dma_done | irq_gpu
	gx_gpu.reset_320x240()
	gx_gpu.display_origin(terminal_layout.vram_origin)
	gx_gpu.draw_target(terminal_layout.vram_origin)
	dma_transfer.copy_to_gp0(assets.bin_gx_system_texture_addr, assets.bin_gx_system_texture_len >> 2)
	initialize_boot_output()
	terminal.flush()
end

init()
*irq_mask = irq_dma_done | irq_vblank | irq_gpu
*input_control = input_arm
while true do
	vblank.wait()
	update_boot_screen()
	*input_control = input_arm
end
