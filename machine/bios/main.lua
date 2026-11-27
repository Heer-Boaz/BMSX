module<entry>
-- BMSX system boot firmware

require('base')
table = require('table')
string = require('string')
utf8 = require('utf8')
coroutine = require('coroutine')
lua_compiler = require('compiler/api')
load = lua_compiler.load
os = require('os')

math = require('math')

local dma_transfer<const> = require('kernel/dma')
local gx_gpu<const> = require('gpu/gpu')
local assets<const> = require('bmsx/system_assets')
local interrupts<const> = require('kernel/interrupts')
local monitor<const> = require('shell/monitor')
require('shell/repl')
local terminal<const> = require('tty/terminal')
local console<const> = require('tty/console')
local terminal_layout<const> = require('tty/layout')
local vblank<const> = require('kernel/vblank')
local vblank_irq<const> = require('kernel/vblank_irq')
local heap_floor<const> = require('kernel/heap_floor')
local image_bind<const> = require('kernel/system_image_bind')
local exception_bridge<const> = require('kernel/exception_bridge')
local vectors<const> = require('bmsx/startup')

local irq_mask<const>: *word = 0x08000008
local input_control<const>: *word = 0x08000064

local cart_rom_magic<const> = 0x58534d42
local cart_rom_boot_header_size<const> = 60
local cart_rom_magic_index<const> = 0
local cart_rom_header_size_index<const> = 1
local cart_blua32_image_index<const> = 8
local cart_blua32_startup_index<const> = 10
local cart_blua32_irq_index<const> = 11
local cart_select<const>: *word = 0x08010420
local cart_status<const>: *word = 0x08010424
local cart_rom_byte_count<const>: *word = 0x08010440
local system_rom_bytes<const>: *u32 = 0x080101f4
local cart0_rom_bytes<const>: *u32 = 0x080101f8
local cart1_rom_bytes<const>: *u32 = 0x080101fc
local cart_rom_base<const> = 0x10000000
local cart_rom<const>: *word = cart_rom_base
local cart_irq_target<const>: *word = vblank_irq.cartridge_target
local cart_irq_frame_width<const>: *word = vblank_irq.cartridge_frame_width
local image_header_size<const> = 92
local sys_control<const>: *u32 = 0x0801034c
local inhibit_reset<const> = 0x100
local irq_vblank<const> = interrupts.vblank
local irq_dma_done<const> = interrupts.dma_done
local input_arm<const> = 0x00000001
local cart_state_missing<const> = 1
local cart_state_invalid<const> = 2
local cart_state_ready<const> = 3
local boot_delay_frames<const> = 50
local boot_countdown_frames_per_tenth<const> = 5
local ascii_zero<const> = 0x30

struct image_sections
	before_data: u32[16]
	data_size: u32
	data_target: addr
	bss_target: addr
	bss_size: u32
end

bss boot_cart_state: word
bss boot_frame: word

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
			local cart_bytes<const> = *cart_rom_byte_count
			if cart_bytes >= cart_rom_boot_header_size
				and cart_rom[cart_rom_magic_index] == cart_rom_magic
				and cart_rom[cart_rom_header_size_index] >= cart_rom_boot_header_size then
				local image_offset<const> = cart_rom[cart_blua32_image_index]
				local startup<const> = cart_rom[cart_blua32_startup_index]
				if startup ~= 0 and image_offset >= cart_rom_boot_header_size
					and image_offset <= cart_bytes - image_header_size and (image_offset & 3) == 0 then
					return cart_state_ready, startup, cart_rom_base + image_offset, slot
				end
			end
		end
	end
	return state, 0, 0, 0
end

local initialize_boot_output<const> = function()
	terminal.open(terminal_layout.width, terminal_layout.height)
	print('BMSX SYSTEM ROM')
	print('CPU       BLUA32')
	print('VIDEO     320X240 50HZ')
	console.flush()
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
	console.flush()
end

local update_boot_screen<const> = function()
	local cart_state<const>, startup<const>, image<const>, slot<const> = scan_cartridges()
	update_boot_output(cart_state)
	if cart_state == cart_state_ready and *boot_frame >= boot_delay_frames then
		terminal.clear_status()
		terminal.flush()
		*irq_mask = 0
		local sections<const>: *image_sections = image
		local data_end<const> = sections.data_target + sections.data_size
		local bss_end<const> = sections.bss_target + sections.bss_size
		local static_end<const> = data_end > bss_end and data_end or bss_end
		cop0.status = cop0.status | inhibit_reset
		local end_address<const> = heap_floor.admit_static_end(static_end)
		if end_address == 0 then
			cop0.status = cop0.status & ~inhibit_reset
			*sys_control = 8
			while true do halt_until_irq end
		end
		cop0.ram_end = end_address
		local root<const> = coroutine.running()
		if image_bind.bind_cartridge(slot, image, *system_rom_bytes, *cart0_rom_bytes, *cart1_rom_bytes, startup, root) ~= 0 then
			cop0.status = cop0.status & ~inhibit_reset
			*sys_control = 8
			while true do halt_until_irq end
		end
		local irq_address<const> = cart_rom[cart_blua32_irq_index]
		*cart_irq_frame_width = exception_bridge.frame_width(irq_address)
		*cart_irq_target = irq_address | (slot << 31)
		cop0.status = cop0.status & ~inhibit_reset
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
	*irq_mask = irq_dma_done
	gx_gpu.reset_320x240()
	gx_gpu.display_origin(terminal_layout.vram_origin)
	gx_gpu.draw_target(terminal_layout.vram_origin)
	dma_transfer.copy_to_gp0(assets.bin_gx_system_texture_addr, assets.bin_gx_system_texture_len >> 2)
	initialize_boot_output()
	terminal.flush()
end

init()
cop0.system_vector = vectors.exception_bridge
cop0.irq_vector = vectors.user_irq
*irq_mask = irq_dma_done | irq_vblank
*input_control = input_arm
while true do
	vblank.wait()
	update_boot_screen()
	*input_control = input_arm
end
