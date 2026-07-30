local round_to_nearest<const> = require('bios/util/round_to_nearest')
local gx_gpu<const> = {}

local gp0<const>: *word = 0x08010238
local gp1<const>: *word = 0x0801023c
local pcrtc_pmode<const>: *word = 0x08010350
local pcrtc_dispfb1_low<const>: *word = 0x08010358
local pcrtc_dispfb1_high<const>: *word = 0x0801035c
local pcrtc_display1_low<const>: *word = 0x08010360
local pcrtc_display1_high<const>: *word = 0x08010364
local pcrtc_display2_low<const>: *word = 0x08010370
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
local pcrtc_enable_circuit2<const> = 2
local pcrtc_constant_alpha<const> = 1 << 5
local pcrtc_alpha_opaque<const> = 0xff << 8

local gp0_fill_rectangle<const> = 0x02000000
local gp0_draw_rectangle<const> = 0x60000000
local gp0_draw_triangle<const> = 0x20000000
local gp0_draw_quad<const> = 0x28000000
local gp0_draw_semitransparent_quad<const> = 0x2a000000
local gp0_draw_gouraud_triangle<const> = 0x30000000
local gp0_draw_textured_quad<const> = 0x2c000000
local gp0_draw_raw_textured_quad<const> = 0x2d000000
local gp0_draw_textured_rectangle<const> = 0x64000000
local gp0_draw_raw_textured_rectangle<const> = 0x65000000
local gp0_draw_semitransparent_rectangle<const> = 0x62000000
local gp0_draw_line<const> = 0x40000000
local gp0_irq_request<const> = 0x1f000000
local gp0_vram_to_vram<const> = 0x80000000
local gp0_cpu_to_vram<const> = 0xa0000000
local gp0_draw_mode<const> = 0xe1000000
local gp0_drawing_area_top_left<const> = 0xe3000000
local gp0_drawing_area_bottom_right<const> = 0xe4000000
local gp0_drawing_offset<const> = 0xe5000000
local gp0_mask_bit_mode<const> = 0xe6000000

local draw_mode_blend_half<const> = 0x00000000
local draw_mode_blend_add<const> = 0x00000020
local draw_mode_blend_subtract<const> = 0x00000040
local draw_mode_blend_quarter<const> = 0x00000060
local texture_mode_palette4<const> = 0x00000000
local texture_mode_direct16<const> = 0x00000002
local draw_mode_texture_palette4<const> = texture_mode_palette4 << 7
local draw_mode_texture_direct16<const> = texture_mode_direct16 << 7
local draw_mode_texture_rectangle_x_flip<const> = 0x00001000
local draw_mode_texture_rectangle_y_flip<const> = 0x00002000

local texture_page_span<const> = 256
local sqrt<const> = require('bios/math').sqrt

local current_draw_mode = 0
local current_display_size_word = 0
local current_draw_origin_word = 0
local current_pcrtc_enable_word = 0

local argb_to_gp0_rgb<const> = function(color)
	return ((color & 0x00ff0000) >> 16) | (color & 0x0000ff00) | ((color & 0x000000ff) << 16)
end

local argb_to_gp0_texture_rgb<const> = function(color)
	return (((((color >> 16) & 0x000000ff) * 128) + 127) // 255)
		| ((((((color >> 8) & 0x000000ff) * 128) + 127) // 255) << 8)
		| (((((color & 0x000000ff) * 128) + 127) // 255) << 16)
end

local xy<const> = function(x, y)
	return (round_to_nearest(x) & 0x0000ffff) | ((round_to_nearest(y) & 0x0000ffff) << 16)
end

local wh<const> = function(width, height)
	return (round_to_nearest(width) & 0x0000ffff) | ((round_to_nearest(height) & 0x0000ffff) << 16)
end

local uv<const> = function(u, v)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8)
end

local uv_texpage<const> = function(u, v, draw_mode)
	return uv(u, v) | (draw_mode << 16)
end

local rgba8888_to_direct16<const> = function(color)
	if (color & 0xff000000) == 0 then
		return 0
	end
	local direct16<const> = ((color & 0x000000f8) >> 3) | ((color & 0x0000f800) >> 6) | ((color & 0x00f80000) >> 9)
	return direct16 | 0x00008000
end

local draw_mode_for_texture_page<const> = function(source_x, source_y)
	return draw_mode_texture_direct16 | (current_draw_mode & 0x00000060) | (((source_x >> 8) & 0x00000003) << 2) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local draw_mode_for_palette4_page<const> = function(texture_x, source_x, source_y)
	local page_x<const> = texture_x + ((source_x >> 8) << 6)
	return draw_mode_texture_palette4 | (current_draw_mode & 0x00000060) | ((page_x >> 6) & 0x0000000f) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local uv_clut<const> = function(u, v, clut_x, clut_y)
	return uv(u, v) | ((((clut_x >> 4) & 0x0000003f) | ((clut_y & 0x000003ff) << 6)) << 16)
end

function gx_gpu.draw_target(origin_word)
	local x<const> = origin_word & 0x0000ffff
	local y<const> = origin_word >> 16
	local width<const> = current_display_size_word & 0x0000ffff
	local height<const> = current_display_size_word >> 16
	current_draw_origin_word = origin_word
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

local program_display<const> = function(horizontal_resolution, display_mode, vertical_start, width, height, vertical_range_height, syncv_low, smode2_word)
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
	current_display_size_word = width | (height << 16)
	program_pcrtc_timing(video_standard, syncv_low, smode2_word)
	gx_gpu.display_origin(0)
	program_pcrtc_circuit1(signal_x, signal_y, pcrtc_standard_signal_step_x, width, height)
	*gp1 = gp1_horizontal_display_range
	*gp1 = gp1_vertical_display_range | vertical_start | ((vertical_start + vertical_range_height) << 10)
	*gp1 = gp1_dma_direction_cpu_to_gp0
	current_draw_mode = draw_mode_blend_half
	*gp0 = gp0_draw_mode | current_draw_mode
	gx_gpu.draw_target(0)
	*gp0 = gp0_mask_bit_mode
	*gp1 = gp1_display_enable
	current_pcrtc_enable_word = pcrtc_enable_circuit1 | pcrtc_constant_alpha | pcrtc_alpha_opaque
	*pcrtc_pmode = current_pcrtc_enable_word
end

function gx_gpu.reset_320x240()
	program_display(horizontal_resolution_320, display_mode_50hz, vertical_display_range_50hz_start, 320, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_256x192()
	program_display(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 192, 192, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_256x212()
	program_display(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 212, 212, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_256x240()
	program_display(horizontal_resolution_256, display_mode_50hz, vertical_display_range_50hz_start, 256, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_368x240()
	program_display(horizontal_resolution_368, display_mode_50hz, vertical_display_range_50hz_start, 368, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_512x240()
	program_display(horizontal_resolution_512, display_mode_50hz, vertical_display_range_50hz_start, 512, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_640x240()
	program_display(horizontal_resolution_640, display_mode_50hz, vertical_display_range_50hz_start, 640, 240, 240, pcrtc_syncv_50hz_progressive_low, pcrtc_smode2_progressive)
end

function gx_gpu.reset_640x480i()
	program_display(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_vertical_interlace, vertical_display_range_60hz_240_start, 640, 480, 240, pcrtc_syncv_60hz_interlaced_low, pcrtc_smode2_interlaced)
end

function gx_gpu.reset_640x448i()
	program_display(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_vertical_interlace, vertical_display_range_60hz_224_start, 640, 448, 224, pcrtc_syncv_60hz_interlaced_low, pcrtc_smode2_interlaced)
end

function gx_gpu.reset_640x512i()
	program_display(horizontal_resolution_640, display_mode_vertical_resolution | display_mode_50hz | display_mode_vertical_interlace, vertical_display_range_50hz_start, 640, 512, 256, pcrtc_syncv_50hz_interlaced_low, pcrtc_smode2_interlaced)
end

function gx_gpu.prepare_supervisor_256x192(origin_word)
	local smode1_word<const> = *pcrtc_smode1_low
	local display2_word<const> = *pcrtc_display2_low
	local signal_step_x<const> = (smode1_word >> 21) & 0x0000000f
	*gp1 = gp1_vram_y_address_extension
	current_display_size_word = 256 | (192 << 16)
	gx_gpu.display_origin(origin_word)
	program_pcrtc_circuit1(display2_word & 0x00000fff, (display2_word >> 12) & 0x000007ff, signal_step_x, 256, 192)
	*gp1 = gp1_horizontal_display_range
	*gp1 = gp1_vertical_display_range | vertical_display_range_50hz_start | ((vertical_display_range_50hz_start + 192) << 10)
	*gp1 = gp1_dma_direction_cpu_to_gp0
	current_draw_mode = draw_mode_blend_half
	*gp0 = gp0_draw_mode | current_draw_mode
	gx_gpu.draw_target(origin_word)
	*gp0 = gp0_mask_bit_mode
	*gp1 = gp1_display_enable
	current_pcrtc_enable_word = (*pcrtc_pmode & pcrtc_enable_circuit2) | pcrtc_enable_circuit1
end

function gx_gpu.display_size()
	return current_display_size_word & 0x0000ffff, current_display_size_word >> 16
end

function gx_gpu.enable_display()
	*gp1 = gp1_display_enable
	*pcrtc_pmode = current_pcrtc_enable_word
end

function gx_gpu.disable_display()
	*gp1 = gp1_display_disable
	*pcrtc_pmode = 0
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

function gx_gpu.clear_color(color)
	*gp0 = gp0_fill_rectangle | argb_to_gp0_rgb(color)
	*gp0 = current_draw_origin_word
	*gp0 = current_display_size_word
end

function gx_gpu.request_irq()
	*gp0 = gp0_irq_request
end

local emit_rect_color<const> = function(opcode, x0, y0, x1, y1, color)
	*gp0 = opcode | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = wh(x1 - x0, y1 - y0)
end

function gx_gpu.fill_rect_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0_draw_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.set_draw_mode(draw_mode)
	current_draw_mode = draw_mode
	*gp0 = gp0_draw_mode | draw_mode
end

function gx_gpu.fill_rect_semitrans_color(x0, y0, x1, y1, color)
	emit_rect_color(gp0_draw_semitransparent_rectangle, x0, y0, x1, y1, color)
end

function gx_gpu.draw_line_color(x0, y0, x1, y1, color)
	*gp0 = gp0_draw_line | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
end

local emit_quad_color<const> = function(opcode, x0, y0, x1, y1, x2, y2, x3, y3, color)
	*gp0 = opcode | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
	*gp0 = xy(x3, y3)
end

local draw_thick_line<const> = function(rect_opcode, quad_opcode, x0, y0, x1, y1, color, thickness)
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	local half<const> = thickness * 0.5
	if dx == 0 and dy == 0 then
		emit_rect_color(rect_opcode, x0 - half, y0 - half, x0 + half, y0 + half, color)
		return
	end
	local length<const> = sqrt(dx * dx + dy * dy)
	local tangent_x<const> = dx / length
	local tangent_y<const> = dy / length
	local normal_x<const> = -tangent_y
	local normal_y<const> = tangent_x
	emit_quad_color(
		quad_opcode,
		x0 - tangent_x * half - normal_x * half,
		y0 - tangent_y * half - normal_y * half,
		x1 + tangent_x * half - normal_x * half,
		y1 + tangent_y * half - normal_y * half,
		x0 - tangent_x * half + normal_x * half,
		y0 - tangent_y * half + normal_y * half,
		x1 + tangent_x * half + normal_x * half,
		y1 + tangent_y * half + normal_y * half,
		color
	)
end

function gx_gpu.draw_thick_line_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(gp0_draw_rectangle, gp0_draw_quad, x0, y0, x1, y1, color, thickness)
end

function gx_gpu.draw_thick_line_semitrans_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(gp0_draw_semitransparent_rectangle, gp0_draw_semitransparent_quad, x0, y0, x1, y1, color, thickness)
end

function gx_gpu.draw_triangle_color(x0, y0, x1, y1, x2, y2, color)
	*gp0 = gp0_draw_triangle | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
end

function gx_gpu.draw_gouraud_triangle_color(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	*gp0 = gp0_draw_gouraud_triangle | argb_to_gp0_rgb(color0)
	*gp0 = xy(x0, y0)
	*gp0 = argb_to_gp0_rgb(color1)
	*gp0 = xy(x1, y1)
	*gp0 = argb_to_gp0_rgb(color2)
	*gp0 = xy(x2, y2)
end

function gx_gpu.upload_rgba8888_to_direct16_stride(source_addr, source_x, source_y, source_stride, target_x, target_y, width, height)
	gx_gpu.begin_vram_upload(target_x, target_y, width, height)
	local source_words<const>: *word = source_addr
	local pending_word = 0
	local pending_half = 0
	for row = 0, height - 1 do
		local source_index<const> = (source_y + row) * source_stride + source_x
		for column = 0, width - 1 do
			local pixel<const> = rgba8888_to_direct16(source_words[source_index + column])
			if pending_half == 0 then
				pending_word = pixel
				pending_half = 1
			else
				*gp0 = pending_word | (pixel << 16)
				pending_half = 0
			end
		end
	end
	if pending_half ~= 0 then
		*gp0 = pending_word
	end
end

function gx_gpu.begin_vram_upload(target_x, target_y, width, height)
	*gp0 = gp0_cpu_to_vram
	*gp0 = xy(target_x, target_y)
	*gp0 = wh(width, height)
end

function gx_gpu.draw_direct16_textured_rect_color(source_x, source_y, x, y, width, height, color, rectangle_flip_mode)
	local raw_texture<const> = (color & 0x00ffffff) == 0x00ffffff
	local texture_x<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_y<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	*gp0 = gp0_draw_mode | draw_mode_for_texture_page(texture_x, texture_y) | rectangle_flip_mode
	if raw_texture then
		*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
	else
		*gp0 = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x, y)
	*gp0 = (texture_x & 0x000000ff) | ((texture_y & 0x000000ff) << 8)
	*gp0 = wh(width, height)
end

function gx_gpu.draw_palette4_textured_rect_color(texture_x, clut_x, clut_y, source_x, source_y, x, y, width, height, color, rectangle_flip_mode)
	local texture_source_x<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_x_flip) ~= 0 and source_x + width - 1 or source_x
	local texture_source_y<const> = (rectangle_flip_mode & draw_mode_texture_rectangle_y_flip) ~= 0 and source_y + height - 1 or source_y
	*gp0 = gp0_draw_mode | draw_mode_for_palette4_page(texture_x, texture_source_x, texture_source_y) | rectangle_flip_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_rectangle | 0x00808080
	else
		*gp0 = gp0_draw_textured_rectangle | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x, y)
	*gp0 = uv_clut(texture_source_x, texture_source_y, clut_x, clut_y)
	*gp0 = wh(width, height)
end

function gx_gpu.draw_direct16_textured_quad_color(
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color)
	local draw_mode<const> = draw_mode_for_texture_page(page_source_x, page_source_y)
	*gp0 = gp0_draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_quad | 0x00808080
	else
		*gp0 = gp0_draw_textured_quad | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = uv(source_x0, source_y0)
	*gp0 = xy(x1, y1)
	*gp0 = uv_texpage(source_x1, source_y1, draw_mode)
	*gp0 = xy(x2, y2)
	*gp0 = uv(source_x2, source_y2)
	*gp0 = xy(x3, y3)
	*gp0 = uv(source_x3, source_y3)
end

function gx_gpu.draw_palette4_textured_quad_color(
	texture_x, clut_x, clut_y,
	page_source_x, page_source_y,
	source_x0, source_y0,
	source_x1, source_y1,
	source_x2, source_y2,
	source_x3, source_y3,
	x0, y0,
	x1, y1,
	x2, y2,
	x3, y3,
	color)
	local draw_mode<const> = draw_mode_for_palette4_page(texture_x, page_source_x, page_source_y)
	*gp0 = gp0_draw_mode | draw_mode
	if (color & 0x00ffffff) == 0x00ffffff then
		*gp0 = gp0_draw_raw_textured_quad | 0x00808080
	else
		*gp0 = gp0_draw_textured_quad | argb_to_gp0_texture_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = uv_clut(source_x0, source_y0, clut_x, clut_y)
	*gp0 = xy(x1, y1)
	*gp0 = uv_texpage(source_x1, source_y1, draw_mode)
	*gp0 = xy(x2, y2)
	*gp0 = uv(source_x2, source_y2)
	*gp0 = xy(x3, y3)
	*gp0 = uv(source_x3, source_y3)
end

gx_gpu.draw_mode_blend_half = draw_mode_blend_half
gx_gpu.draw_mode_blend_add = draw_mode_blend_add
gx_gpu.draw_mode_blend_subtract = draw_mode_blend_subtract
gx_gpu.draw_mode_blend_quarter = draw_mode_blend_quarter
gx_gpu.texture_mode_palette4 = texture_mode_palette4
gx_gpu.texture_mode_direct16 = texture_mode_direct16
gx_gpu.texture_page_span = texture_page_span

return gx_gpu
