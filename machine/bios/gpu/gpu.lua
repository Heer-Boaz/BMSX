local gx_gpu<const> = {}

local gp0<const>: *word = 0x08010238
local gp1<const>: *word = 0x0801023c
local pcrtc_pmode<const>: *word = 0x08010350
local pcrtc_dispfb1_low<const>: *word = 0x08010358
local pcrtc_dispfb1_high<const>: *word = 0x0801035c
local pcrtc_display1_low<const>: *word = 0x08010360
local pcrtc_display1_high<const>: *word = 0x08010364
local pcrtc_display2_low<const>: *word = 0x08010370
local pcrtc_display2_high<const>: *word = 0x08010374
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
local gp1_ack_irq<const> = 0x02000000
local gp1_display_enable<const> = 0x03000000
local gp1_dma_direction_cpu_to_gp0<const> = 0x04000002
local gp1_display_start<const> = 0x05000000
local gp1_horizontal_display_range<const> = 0x06c60260
local gp1_vertical_display_range<const> = 0x07000000
local gp1_display_mode_320x240_50hz<const> = 0x08000009
local gp1_vram_y_address_extension<const> = 0x09000001
local vertical_display_range_start<const> = 35

local pcrtc_framebuffer_width_1024<const> = 16 << 9
local pcrtc_psmgx16<const> = 31 << 15
local pcrtc_enable_circuit1<const> = 1
local pcrtc_enable_circuit2<const> = 2
local pcrtc_constant_alpha<const> = 1 << 5
local pcrtc_alpha_opaque<const> = 0xff << 8

local gp0_fill_rectangle<const> = 0x02000000
local gp0_draw_rectangle<const> = 0x60000000
local gp0_draw_textured_rectangle<const> = 0x64000000
local gp0_irq_request<const> = 0x1f000000
local gp0_vram_to_vram<const> = 0x80000000
local gp0_draw_mode<const> = 0xe1000000
local gp0_drawing_area_top_left<const> = 0xe3000000
local gp0_drawing_area_bottom_right<const> = 0xe4000000
local gp0_drawing_offset<const> = 0xe5000000
local gp0_mask_bit_mode<const> = 0xe6000000
local draw_mode_texture_direct16<const> = 0x00000100

local current_display_size_word = 0
local current_pcrtc_enable_word = 0

local xy<const> = function(x, y)
	return (x & 0x0000ffff) | ((y & 0x0000ffff) << 16)
end

local wh<const> = function(width, height)
	return (width & 0x0000ffff) | ((height & 0x0000ffff) << 16)
end

local uv<const> = function(u, v)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8)
end

local draw_mode_for_texture_page<const> = function(source_x, source_y)
	return draw_mode_texture_direct16
		| (((source_x >> 8) & 0x00000003) << 2)
		| ((source_y & 0x00000100) >> 4)
		| ((source_y & 0x00000200) << 2)
end

function gx_gpu.draw_target(origin_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	local width<const> = current_display_size_word & 0x0000ffff
	local height<const> = current_display_size_word >> 16
	*gp0 = gp0_drawing_area_top_left | x | (y << 10)
	*gp0 = gp0_drawing_area_bottom_right | (x + width - 1) | ((y + height - 1) << 10)
	*gp0 = gp0_drawing_offset | (x & 0x000007ff) | ((y & 0x000007ff) << 11)
end

function gx_gpu.display_origin(origin_word)
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

function gx_gpu.reset_320x240()
	*gp1 = gp1_reset
	*gp1 = gp1_vram_y_address_extension
	*gp1 = gp1_display_mode_320x240_50hz
	current_display_size_word = 320 | (240 << 16)
	*pcrtc_smode1_low = 0x40836504
	*pcrtc_smode1_high = 0x00000007
	*pcrtc_synch1_low = 0x1fc83030
	*pcrtc_synch1_high = 0x0007f5c2
	*pcrtc_synch2_low = 0x003484bc
	*pcrtc_synch2_high = 0
	*pcrtc_syncv_low = 0x02101404
	*pcrtc_syncv_high = 0x00a90005
	*pcrtc_smode2_low = 0
	*pcrtc_smode2_high = 0
	*pcrtc_smode1_low = 0x40806504
	gx_gpu.display_origin(0)
	program_pcrtc_circuit1(680, 37, 4, 320, 240)
	*gp1 = gp1_horizontal_display_range
	*gp1 = gp1_vertical_display_range | vertical_display_range_start | ((vertical_display_range_start + 240) << 10)
	*gp1 = gp1_dma_direction_cpu_to_gp0
	*gp0 = gp0_draw_mode
	gx_gpu.draw_target(0)
	*gp0 = gp0_mask_bit_mode
	*gp1 = gp1_display_enable
	current_pcrtc_enable_word = pcrtc_enable_circuit1 | pcrtc_constant_alpha | pcrtc_alpha_opaque
	*pcrtc_pmode = current_pcrtc_enable_word
end

function gx_gpu.prepare_supervisor(origin_word, maximum_width, maximum_height)
	local smode1_word<const> = *pcrtc_smode1_low
	local display2_word<const> = *pcrtc_display2_low
	local display2_extent_word<const> = *pcrtc_display2_high
	local signal_step_x<const> = (smode1_word >> 21) & 0x0000000f
	local signal_width = maximum_width * signal_step_x
	local height = maximum_height
	if (*pcrtc_pmode & pcrtc_enable_circuit2) ~= 0 then
		local retained_signal_width<const> = (display2_extent_word & 0x00000fff) + 1
		local retained_height<const> = ((display2_extent_word >> 12) & 0x000007ff) + 1
		if retained_signal_width < signal_width then
			signal_width = retained_signal_width
		end
		if retained_height < height then
			height = retained_height
		end
	end
	local signal_x<const> = display2_word & 0x00000fff
	local display_left<const> = (signal_x + signal_step_x - 1) // signal_step_x
	local display_right<const> = (signal_x + signal_width + signal_step_x - 1) // signal_step_x
	local width<const> = display_right - display_left
	*gp1 = gp1_vram_y_address_extension
	current_display_size_word = width | (height << 16)
	gx_gpu.display_origin(origin_word)
	*pcrtc_display1_low = signal_x | (display2_word & 0x007ff000) | ((signal_step_x - 1) << 23)
	*pcrtc_display1_high = (signal_width - 1) | ((height - 1) << 12)
	*gp1 = gp1_horizontal_display_range
	*gp1 = gp1_vertical_display_range | vertical_display_range_start | ((vertical_display_range_start + height) << 10)
	*gp1 = gp1_dma_direction_cpu_to_gp0
	*gp0 = gp0_draw_mode
	gx_gpu.draw_target(origin_word)
	*gp0 = gp0_mask_bit_mode
	*gp1 = gp1_display_enable
	current_pcrtc_enable_word = (*pcrtc_pmode & pcrtc_enable_circuit2) | pcrtc_enable_circuit1
	return width, height
end

function gx_gpu.enable_display()
	*gp1 = gp1_display_enable
	*pcrtc_pmode = current_pcrtc_enable_word
end

function gx_gpu.ack_irq()
	*gp1 = gp1_ack_irq
end

function gx_gpu.encode_fill_rectangle(words, index, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_fill_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = wh(width, height)
	return index + 3
end

function gx_gpu.encode_rectangle(words, index, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_draw_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = wh(width, height)
	return index + 3
end

function gx_gpu.encode_vram_copy(words, index, source_x, source_y, target_x, target_y, width, height)
	local target<const>: *word = words
	target[index] = gp0_vram_to_vram
	target[index + 1] = xy(source_x, source_y)
	target[index + 2] = xy(target_x, target_y)
	target[index + 3] = wh(width, height)
	return index + 4
end

function gx_gpu.encode_direct16_texture_page(words, index, source_x, source_y)
	local target<const>: *word = words
	target[index] = gp0_draw_mode | draw_mode_for_texture_page(source_x, source_y)
	return index + 1
end

function gx_gpu.encode_textured_rectangle(words, index, source_x, source_y, x, y, width, height, color_word)
	local target<const>: *word = words
	target[index] = gp0_draw_textured_rectangle | color_word
	target[index + 1] = xy(x, y)
	target[index + 2] = uv(source_x, source_y)
	target[index + 3] = wh(width, height)
	return index + 4
end

function gx_gpu.encode_irq_request(words, index)
	local target<const>: *word = words
	target[index] = gp0_irq_request
	return index + 1
end

function gx_gpu.encode_mask_bit_mode(words, index, mode_word)
	local target<const>: *word = words
	target[index] = gp0_mask_bit_mode | mode_word
	return index + 1
end

return gx_gpu
