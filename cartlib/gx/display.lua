local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local display_presets<const> = require('bmsx/gx_display_presets')
local gx_registers<const> = require('bmsx/gx_registers')

local display<const> = {}

local gp1<const>: *word = 0x08010240
local pcrtc_pmode<const>: *word = 0x08010354
local pcrtc_dispfb1_low<const>: *word = 0x0801035c
local pcrtc_dispfb1_high<const>: *word = 0x08010360
local pcrtc_display1_low<const>: *word = 0x08010364
local pcrtc_display1_high<const>: *word = 0x08010368
local pcrtc_smode1_low<const>: *word = 0x080103ac
local pcrtc_smode1_high<const>: *word = 0x080103b0
local pcrtc_smode2_low<const>: *word = 0x080103b4
local pcrtc_smode2_high<const>: *word = 0x080103b8
local pcrtc_synch1_low<const>: *word = 0x080103bc
local pcrtc_synch1_high<const>: *word = 0x080103c0
local pcrtc_synch2_low<const>: *word = 0x080103c4
local pcrtc_synch2_high<const>: *word = 0x080103c8
local pcrtc_syncv_low<const>: *word = 0x080103cc
local pcrtc_syncv_high<const>: *word = 0x080103d0

function display.origin(origin_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	*gp1 = gx_registers.gp1_display_start_command | x | (y << 10)
	local framebuffer_address<const> = (y << 10) + x
	local framebuffer_offset<const> = framebuffer_address & 0x00000fff
	*pcrtc_dispfb1_low = (framebuffer_address >> 12) | display_presets.pcrtc_dispfb_gx16_1024_layout_word
	*pcrtc_dispfb1_high = (framebuffer_offset & 0x000003ff) | ((framebuffer_offset >> 10) << 11)
end

local program_pcrtc_timing<const> = function(display_mode_command, syncv_low_word, smode2_low_word)
	local smode1_run_low_word = display_presets.ntsc_smode1_run_low_word
	if (display_mode_command & gx_registers.gp1_display_mode_50hz_bit) ~= 0 then
		*pcrtc_smode1_low = display_presets.pal_smode1_setup_low_word
		*pcrtc_smode1_high = display_presets.pal_smode1_high_word
		*pcrtc_synch1_low = display_presets.pal_synch1_low_word
		*pcrtc_synch1_high = display_presets.pal_synch1_high_word
		*pcrtc_synch2_low = display_presets.pal_synch2_low_word
		*pcrtc_synch2_high = display_presets.pal_synch2_high_word
		*pcrtc_syncv_high = display_presets.pal_syncv_high_word
		smode1_run_low_word = display_presets.pal_smode1_run_low_word
	else
		*pcrtc_smode1_low = display_presets.ntsc_smode1_setup_low_word
		*pcrtc_smode1_high = display_presets.ntsc_smode1_high_word
		*pcrtc_synch1_low = display_presets.ntsc_synch1_low_word
		*pcrtc_synch1_high = display_presets.ntsc_synch1_high_word
		*pcrtc_synch2_low = display_presets.ntsc_synch2_low_word
		*pcrtc_synch2_high = display_presets.ntsc_synch2_high_word
		*pcrtc_syncv_high = display_presets.ntsc_syncv_high_word
	end
	*pcrtc_syncv_low = syncv_low_word
	*pcrtc_smode2_low = smode2_low_word
	*pcrtc_smode2_high = 0
	*pcrtc_smode1_low = smode1_run_low_word
end

local program<const> = function(
	size_word,
	display_mode_command,
	vertical_range_command,
	pcrtc_display_low_word,
	pcrtc_display_high_word,
	pcrtc_syncv_low_word,
	pcrtc_smode2_low_word
)
	*gp1 = gx_registers.gp1_reset_command
	*gp1 = gx_registers.gp1_vram_y_address_extension_command
	*gp1 = display_mode_command
	program_pcrtc_timing(display_mode_command, pcrtc_syncv_low_word, pcrtc_smode2_low_word)
	display.origin(0)
	*pcrtc_display1_low = pcrtc_display_low_word
	*pcrtc_display1_high = pcrtc_display_high_word
	*gp1 = display_presets.gp1_horizontal_display_range_command
	*gp1 = vertical_range_command
	*gp1 = gx_registers.gp1_dma_cpu_to_gp0_command
	gx_gpu.set_draw_mode(gp0.draw_mode_blend_half)
	gx_gpu.draw_target(0, size_word)
	gx_gpu.set_mask_bit_mode(0)
	*gp1 = gx_registers.gp1_display_enable_command
	*pcrtc_pmode = display_presets.pcrtc_pmode_circuit1_opaque_word
end

function display.reset_320x240()
	program(
		display_presets.mode_320x240_size_word,
		display_presets.mode_320x240_gp1_display_mode_command,
		display_presets.mode_320x240_gp1_vertical_range_command,
		display_presets.mode_320x240_pcrtc_display_low_word,
		display_presets.mode_320x240_pcrtc_display_high_word,
		display_presets.mode_320x240_pcrtc_syncv_low_word,
		display_presets.mode_320x240_pcrtc_smode2_low_word
	)
end

function display.reset_256x192()
	program(
		display_presets.mode_256x192_size_word,
		display_presets.mode_256x192_gp1_display_mode_command,
		display_presets.mode_256x192_gp1_vertical_range_command,
		display_presets.mode_256x192_pcrtc_display_low_word,
		display_presets.mode_256x192_pcrtc_display_high_word,
		display_presets.mode_256x192_pcrtc_syncv_low_word,
		display_presets.mode_256x192_pcrtc_smode2_low_word
	)
end

function display.reset_256x212()
	program(
		display_presets.mode_256x212_size_word,
		display_presets.mode_256x212_gp1_display_mode_command,
		display_presets.mode_256x212_gp1_vertical_range_command,
		display_presets.mode_256x212_pcrtc_display_low_word,
		display_presets.mode_256x212_pcrtc_display_high_word,
		display_presets.mode_256x212_pcrtc_syncv_low_word,
		display_presets.mode_256x212_pcrtc_smode2_low_word
	)
end

function display.reset_256x240()
	program(
		display_presets.mode_256x240_size_word,
		display_presets.mode_256x240_gp1_display_mode_command,
		display_presets.mode_256x240_gp1_vertical_range_command,
		display_presets.mode_256x240_pcrtc_display_low_word,
		display_presets.mode_256x240_pcrtc_display_high_word,
		display_presets.mode_256x240_pcrtc_syncv_low_word,
		display_presets.mode_256x240_pcrtc_smode2_low_word
	)
end

function display.reset_368x240()
	program(
		display_presets.mode_368x240_size_word,
		display_presets.mode_368x240_gp1_display_mode_command,
		display_presets.mode_368x240_gp1_vertical_range_command,
		display_presets.mode_368x240_pcrtc_display_low_word,
		display_presets.mode_368x240_pcrtc_display_high_word,
		display_presets.mode_368x240_pcrtc_syncv_low_word,
		display_presets.mode_368x240_pcrtc_smode2_low_word
	)
end

function display.reset_512x240()
	program(
		display_presets.mode_512x240_size_word,
		display_presets.mode_512x240_gp1_display_mode_command,
		display_presets.mode_512x240_gp1_vertical_range_command,
		display_presets.mode_512x240_pcrtc_display_low_word,
		display_presets.mode_512x240_pcrtc_display_high_word,
		display_presets.mode_512x240_pcrtc_syncv_low_word,
		display_presets.mode_512x240_pcrtc_smode2_low_word
	)
end

function display.reset_640x240()
	program(
		display_presets.mode_640x240_size_word,
		display_presets.mode_640x240_gp1_display_mode_command,
		display_presets.mode_640x240_gp1_vertical_range_command,
		display_presets.mode_640x240_pcrtc_display_low_word,
		display_presets.mode_640x240_pcrtc_display_high_word,
		display_presets.mode_640x240_pcrtc_syncv_low_word,
		display_presets.mode_640x240_pcrtc_smode2_low_word
	)
end

function display.reset_640x480i()
	program(
		display_presets.mode_640x480i_size_word,
		display_presets.mode_640x480i_gp1_display_mode_command,
		display_presets.mode_640x480i_gp1_vertical_range_command,
		display_presets.mode_640x480i_pcrtc_display_low_word,
		display_presets.mode_640x480i_pcrtc_display_high_word,
		display_presets.mode_640x480i_pcrtc_syncv_low_word,
		display_presets.mode_640x480i_pcrtc_smode2_low_word
	)
end

function display.reset_640x448i()
	program(
		display_presets.mode_640x448i_size_word,
		display_presets.mode_640x448i_gp1_display_mode_command,
		display_presets.mode_640x448i_gp1_vertical_range_command,
		display_presets.mode_640x448i_pcrtc_display_low_word,
		display_presets.mode_640x448i_pcrtc_display_high_word,
		display_presets.mode_640x448i_pcrtc_syncv_low_word,
		display_presets.mode_640x448i_pcrtc_smode2_low_word
	)
end

function display.reset_640x512i()
	program(
		display_presets.mode_640x512i_size_word,
		display_presets.mode_640x512i_gp1_display_mode_command,
		display_presets.mode_640x512i_gp1_vertical_range_command,
		display_presets.mode_640x512i_pcrtc_display_low_word,
		display_presets.mode_640x512i_pcrtc_display_high_word,
		display_presets.mode_640x512i_pcrtc_syncv_low_word,
		display_presets.mode_640x512i_pcrtc_smode2_low_word
	)
end

function display.read_size_word()
	local display_low<const> = *pcrtc_display1_low
	local display_high<const> = *pcrtc_display1_high
	local signal_step_x<const> = (*pcrtc_smode1_low >> 21) & 0x0000000f
	local signal_x<const> = display_low & 0x00000fff
	local signal_right<const> = signal_x + (display_high & 0x00000fff) + 1
	local left_numerator<const> = signal_x + signal_step_x - 1
	local right_numerator<const> = signal_right + signal_step_x - 1
	local left<const> = (left_numerator - left_numerator % signal_step_x) / signal_step_x
	local right<const> = (right_numerator - right_numerator % signal_step_x) / signal_step_x
	return (right - left) | ((((display_high >> 12) & 0x000007ff) + 1) << 16)
end

function display.size()
	local size_word<const> = display.read_size_word()
	return size_word & 0x0000ffff, size_word >> 16
end

function display.enable()
	*gp1 = gx_registers.gp1_display_enable_command
	*pcrtc_pmode = display_presets.pcrtc_pmode_circuit1_opaque_word
end

function display.disable()
	*gp1 = gx_registers.gp1_display_disable_command
	*pcrtc_pmode = 0
end

return display
