local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')

local display<const> = {}

local gp1<const>: *word = 0x0801023c
local pcrtc_pmode<const>: *word = 0x08010350
local pcrtc_dispfb1_low<const>: *word = 0x08010358
local pcrtc_dispfb1_high<const>: *word = 0x0801035c
local pcrtc_display1_low<const>: *word = 0x08010360
local pcrtc_display1_high<const>: *word = 0x08010364
local pcrtc_smode1_low<const>: *word = 0x080103a8
local pcrtc_smode1_high<const>: *word = 0x080103ac
local pcrtc_smode2_low<const>: *word = 0x080103b0
local pcrtc_smode2_high<const>: *word = 0x080103b4
local pcrtc_synch1_low<const>: *word = 0x080103b8
local pcrtc_synch1_high<const>: *word = 0x080103bc
local pcrtc_synch2_low<const>: *word = 0x080103c0
local pcrtc_synch2_high<const>: *word = 0x080103c4
local pcrtc_syncv_low<const>: *word = 0x080103c8
local pcrtc_syncv_high<const>: *word = 0x080103cc

local gp1_reset<const> = 0x00000000
local gp1_display_enable<const> = 0x03000000
local gp1_display_disable<const> = 0x03000001
local gp1_dma_direction_cpu_to_gp0<const> = 0x04000002
local gp1_display_start<const> = 0x05000000
local gp1_horizontal_display_range<const> = 0x06c60260
local gp1_vertical_display_range<const> = 0x07000000
local gp1_display_mode<const> = 0x08000000
local gp1_vram_y_address_extension<const> = 0x09000001
local horizontal_resolution_256<const> = 0x00000000
local horizontal_resolution_320<const> = 0x00000001
local horizontal_resolution_512<const> = 0x00000002
local horizontal_resolution_640<const> = 0x00000003
local horizontal_resolution_368<const> = 0x00000040
local display_mode_vertical_resolution<const> = 0x00000004
local display_mode_50hz<const> = 0x00000008
local display_mode_vertical_interlace<const> = 0x00000020
local vertical_display_range_60hz_240_start<const> = 16
local vertical_display_range_60hz_224_start<const> = 24
local vertical_display_range_50hz_start<const> = 35
local pcrtc_framebuffer_width_1024<const> = 16 << 9
local pcrtc_psmgx16<const> = 31 << 15
local pcrtc_60hz_signal_x<const> = 652
local pcrtc_60hz_signal_y<const> = 26
local pcrtc_50hz_signal_x<const> = 680
local pcrtc_50hz_signal_y<const> = 37
local pcrtc_standard_signal_step_x<const> = 4
local pcrtc_smode2_progressive<const> = 0
local pcrtc_smode2_interlaced<const> = 1
local pcrtc_syncv_60hz_interlaced_low<const> = 0x01a01801
local pcrtc_syncv_50hz_progressive_low<const> = 0x02101404
local pcrtc_syncv_50hz_interlaced_low<const> = 0x02101401
local pcrtc_enable_circuit1<const> = 1
local pcrtc_constant_alpha<const> = 1 << 5
local pcrtc_alpha_opaque<const> = 0xff << 8
local pcrtc_enable_word<const> = pcrtc_enable_circuit1 | pcrtc_constant_alpha | pcrtc_alpha_opaque

function display.origin(origin_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	*gp1 = gp1_display_start | x | (y << 10)
	local framebuffer_address<const> = (y << 10) + x
	local framebuffer_offset<const> = framebuffer_address & 0x00000fff
	*pcrtc_dispfb1_low = (framebuffer_address >> 12) | pcrtc_framebuffer_width_1024 | pcrtc_psmgx16
	*pcrtc_dispfb1_high = (framebuffer_offset & 0x000003ff) | ((framebuffer_offset >> 10) << 11)
end

local program_pcrtc_circuit1<const> = function(signal_x, signal_y, signal_step_x, width, height)
	*pcrtc_display1_low = signal_x | (signal_y << 12) | ((signal_step_x - 1) << 23)
	*pcrtc_display1_high = ((width * signal_step_x) - 1) | ((height - 1) << 12)
end

local program_pcrtc_timing<const> = function(video_standard, syncv_low, smode2_word)
	local smode1_word = 0x40804504
	local synch1_low = 0x1f06f040
	local synch1_high = 0x0007f5b6
	local synch2_low = 0x0033a4d8
	local syncv_high = 0x00c78006
	if video_standard == display_mode_50hz then
		smode1_word = 0x40806504
		synch1_low = 0x1fc83030
		synch1_high = 0x0007f5c2
		synch2_low = 0x003484bc
		syncv_high = 0x00a90005
	end
	*pcrtc_smode1_low = smode1_word | 0x00030000
	*pcrtc_smode1_high = 0x00000007
	*pcrtc_synch1_low = synch1_low
	*pcrtc_synch1_high = synch1_high
	*pcrtc_synch2_low = synch2_low
	*pcrtc_synch2_high = 0
	*pcrtc_syncv_low = syncv_low
	*pcrtc_syncv_high = syncv_high
	*pcrtc_smode2_low = smode2_word
	*pcrtc_smode2_high = 0
	*pcrtc_smode1_low = smode1_word
end

local program<const> = function(horizontal_resolution, display_mode, vertical_start, width, height, vertical_range_height, syncv_low, smode2_word)
	local video_standard<const> = display_mode & display_mode_50hz
	local signal_x = pcrtc_60hz_signal_x
	local signal_y = pcrtc_60hz_signal_y
	if video_standard == display_mode_50hz then
		signal_x = pcrtc_50hz_signal_x
		signal_y = pcrtc_50hz_signal_y
	end
	if smode2_word == pcrtc_smode2_interlaced then
		signal_y = (signal_y - 1) << 1
	end
	*gp1 = gp1_reset
	*gp1 = gp1_vram_y_address_extension
	*gp1 = gp1_display_mode | horizontal_resolution | display_mode
	program_pcrtc_timing(video_standard, syncv_low, smode2_word)
	display.origin(0)
	program_pcrtc_circuit1(signal_x, signal_y, pcrtc_standard_signal_step_x, width, height)
	*gp1 = gp1_horizontal_display_range
	*gp1 = gp1_vertical_display_range | vertical_start | ((vertical_start + vertical_range_height) << 10)
	*gp1 = gp1_dma_direction_cpu_to_gp0
	gx_gpu.set_draw_mode(gp0.draw_mode_blend_half)
	gx_gpu.draw_target(0, width | (height << 16))
	gx_gpu.set_mask_bit_mode(0)
	*gp1 = gp1_display_enable
	*pcrtc_pmode = pcrtc_enable_word
end

function display.reset_320x240()
	program(horizontal_resolution_320, display_mode_50hz, vertical_display_range_50hz_start, 320, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_256x192()
	program(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 192, 192, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_256x212()
	program(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 212, 212, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_256x240()
	program(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_368x240()
	program(horizontal_resolution_368, display_mode_50hz, vertical_display_range_50hz_start, 368, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_512x240()
	program(horizontal_resolution_512, display_mode_50hz, vertical_display_range_50hz_start, 512, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_640x240()
	program(horizontal_resolution_640, display_mode_50hz, vertical_display_range_50hz_start, 640, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function display.reset_640x480i()
	program(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_vertical_interlace, vertical_display_range_60hz_240_start, 640, 480, 240, pcrtc_syncv_60hz_interlaced_low, pcrtc_smode2_interlaced)
end

function display.reset_640x448i()
	program(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_vertical_interlace, vertical_display_range_60hz_224_start, 640, 448, 224, pcrtc_syncv_60hz_interlaced_low, pcrtc_smode2_interlaced)
end

function display.reset_640x512i()
	program(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_50hz | display_mode_vertical_interlace, vertical_display_range_50hz_start, 640, 512, 256, pcrtc_syncv_50hz_interlaced_low, pcrtc_smode2_interlaced)
end

function display.size()
	local display_low<const> = *pcrtc_display1_low
	local display_high<const> = *pcrtc_display1_high
	local signal_step_x<const> = (*pcrtc_smode1_low >> 21) & 0x0000000f
	local signal_x<const> = display_low & 0x00000fff
	local signal_right<const> = signal_x + (display_high & 0x00000fff) + 1
	local left_numerator<const> = signal_x + signal_step_x - 1
	local right_numerator<const> = signal_right + signal_step_x - 1
	local left<const> = (left_numerator - left_numerator % signal_step_x) / signal_step_x
	local right<const> = (right_numerator - right_numerator % signal_step_x) / signal_step_x
	return right - left, ((display_high >> 12) & 0x000007ff) + 1
end

function display.enable()
	*gp1 = gp1_display_enable
	*pcrtc_pmode = pcrtc_enable_word
end

function display.disable()
	*gp1 = gp1_display_disable
	*pcrtc_pmode = 0
end

return display
