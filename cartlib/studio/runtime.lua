local cartridge_io<const> = require('cartlib/cartridge/io')
local command<const> = require('cartlib/studio/command')
local descriptor<const> = require('cartlib/studio/descriptor')
local dma<const> = require('cartlib/dma')
local editor<const> = require('cartlib/studio/editor')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_vram<const> = require('cartlib/gx/vram')
local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')
local overlay<const> = require('cartlib/studio/overlay')
local protocol<const> = require('cartlib/studio/protocol')

local studio_runtime<const> = {}
studio_runtime.__index = studio_runtime

local cart_select<const>: *word = cartridge_io.select_address
local cart_rom<const>: *word = cartridge_io.rom_address
local cart_ram<const>: *word = cartridge_io.ram_address
local mailbox_data<const>: *word = cartridge_io.mmio_address + cartridge_io.mailbox_data_offset
local mailbox_control<const>: *word = cartridge_io.mmio_address + cartridge_io.mailbox_control_offset
local mailbox_irq_ack<const>: *word = cartridge_io.mmio_address + cartridge_io.mailbox_irq_ack_offset
local required_board_word<const> = cartridge_io.board_ram | cartridge_io.board_mailbox
local mailbox_dreq_word<const> = cartridge_io.mailbox_control_dreq_read
	| cartridge_io.mailbox_control_dreq_write

local board_datapath<const> = {
	[0] = {
		copy_to = dma.copy_to_cartridge0,
		copy_from = dma.copy_from_cartridge0,
		irq = irq_source.cartridge_slot0,
	},
	[1] = {
		copy_to = dma.copy_to_cartridge1,
		copy_from = dma.copy_from_cartridge1,
		irq = irq_source.cartridge_slot1,
	},
}

local detect_board<const> = function()
	local game_slot<const> = *cart_select & 0x00000001
	local board_slot<const> = 1 - game_slot
	*cart_select = board_slot
	local board_id<const> = cart_rom[cartridge_io.rom_header_board_id_word]
	local board_word_address = cartridge_io.slot0_board_address
	local ram_byte_count_address = cartridge_io.slot0_ram_byte_count_address
	if board_slot == 1 then
		board_word_address = cartridge_io.slot1_board_address
		ram_byte_count_address = cartridge_io.slot1_ram_byte_count_address
	end
	local board_word_register<const>: *word = board_word_address
	local ram_byte_count_register<const>: *word = ram_byte_count_address
	local board_word<const> = *board_word_register
	local ram_byte_count<const> = *ram_byte_count_register
	if board_id ~= protocol.board_id
		or (board_word & required_board_word) ~= required_board_word
		or ram_byte_count < protocol.board_ram_bytes then
		*cart_select = game_slot
		return nil
	end
	-- Cartridge RAM survives machine reset. Carry its even publish revision into
	-- the new world, then invalidate the prior descriptor until the next publish.
	local descriptor_revision<const> = cart_ram[protocol.header_revision] & 0xfffffffe
	cart_ram[protocol.header_magic] = 0
	cart_ram[protocol.header_revision] = (descriptor_revision + 1) & 0xffffffff
	*mailbox_control = mailbox_dreq_word
	*cart_select = game_slot
	return game_slot, board_slot, descriptor_revision
end

function studio_runtime.attach(world)
	local game_slot<const>, board_slot<const>, descriptor_revision<const> = detect_board()
	if game_slot == nil then
		return nil
	end
	local page_size<const> = world._page_size
	local overlay_page<const> = gx_vram.allocate(
		page_size & 0x0000ffff,
		page_size >> 16,
		1,
		1
	)
	local overlay_origin<const> = overlay_page.x | (overlay_page.y << 16)
	local game_origin = world._draw_page
	if world._display_page ~= nil then
		game_origin = world._display_page
	end
	gx_gpu.draw_target(overlay_origin, page_size)
	gx_gpu.set_mask_bit_mode(0)
	gx_gpu.clear_color(overlay_origin, page_size, 0)
	gx_gpu.draw_target(world._draw_page, page_size)
	gx_display.configure_dual_readout(game_origin, overlay_origin)
	local datapath<const> = board_datapath[board_slot]
	local runtime<const> = setmetatable({
		game_slot = game_slot,
		board_slot = board_slot,
		page_size = page_size,
		game_origin = game_origin,
		overlay_origin = overlay_origin,
		editor = editor.new(),
		command = command.new(datapath.copy_from),
		descriptor = descriptor.new(datapath.copy_to, descriptor_revision),
		overlay = overlay.new(overlay_origin, page_size),
	}, studio_runtime)
	runtime.mailbox_irq = function()
		*cart_select = board_slot
		runtime.command:signal(*mailbox_data)
		*mailbox_irq_ack = 1
		-- The active executable socket is a known product invariant, not saved
		-- state to capture and restore around a board transaction.
		*cart_select = game_slot
	end
	irq.register(datapath.irq, runtime.mailbox_irq)
	return runtime
end

function studio_runtime:apply_command(world)
	self.command:apply_pending(world, self.editor)
end

function studio_runtime:update_editor(world)
	self.editor:update(world)
end

function studio_runtime:set_game_origin(origin)
	self.game_origin = origin
	gx_display.circuit2_origin(origin)
end

function studio_runtime:render_overlay()
	self.overlay:render(self.editor)
end

function studio_runtime:publish(world)
	self.descriptor:publish(self, world)
end

function studio_runtime:object_disposed(obj)
	self.editor:object_disposed(obj)
end

function studio_runtime:component_detached(comp)
	self.editor:component_detached(comp)
end

return studio_runtime
