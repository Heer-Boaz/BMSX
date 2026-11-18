module<entry>

local assets<const> = require('bmsx/assets')
local config<const> = require('config')
local display<const> = require('cartlib/gx/display')
local gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local imgdec<const> = require('cartlib/gx/imgdec')
local dma<const> = require('cartlib/dma')
local apu<const> = require('cartlib/apu')
local irq<const> = require('cartlib/irq')
local source<const> = require('cartlib/irq/source')
local gp0_port<const>: *word = 0x0801023c

local frame_sources<const> = {
 assets.bin_frame_0_addr, assets.bin_frame_1_addr, assets.bin_frame_2_addr, assets.bin_frame_3_addr,
 assets.bin_frame_4_addr, assets.bin_frame_5_addr, assets.bin_frame_6_addr, assets.bin_frame_7_addr,
}
local frame_words<const> = {
 assets.bin_frame_0_len >> 2, assets.bin_frame_1_len >> 2, assets.bin_frame_2_len >> 2, assets.bin_frame_3_len >> 2,
 assets.bin_frame_4_len >> 2, assets.bin_frame_5_len >> 2, assets.bin_frame_6_len >> 2, assets.bin_frame_7_len >> 2,
}
local actors<const> = {}
for index = 1, config.actors do
 actors[index] = { x = (index * 9) % 312, y = 208 + (index % 5) * 4, dx = (index & 1) * 2 - 1 }
end

stream_vblanks = 0
stream_completed_frames = 0
stream_uploads = 0
stream_late_frames = 0
stream_checksum = 0
local fence_sequence = 0
irq.register(source.vblank, function() stream_vblanks = stream_vblanks + 1 end)
irq.register(source.gpu, function()
 gpu.ack_irq()
 fence_sequence = fence_sequence + 1
end)
display.reset_320x240()

local tone<const> = {
 source_addr = assets.bin_tone_addr, source_bytes = assets.bin_tone_len,
 sample_rate_hz = 7040, channels = 1, bits_per_sample = 16, frame_count = 32,
 data_offset = 0, data_bytes = assets.bin_tone_len, loop_start_sample = 0, loop_end_sample = 16,
}
for slot = 0, config.voices - 1 do
 apu.play(tone, slot, 0x10000 + slot * 0x4000, 0x200, 0, 0, 0x4000, 0, 0)
end

while true do
 local previous_vblank<const> = stream_vblanks
 repeat halt_until_irq until stream_vblanks ~= previous_vblank
 local started<const> = stream_vblanks
 local frame<const> = stream_completed_frames
 for slot = 0, config.uploads - 1 do
  local image<const> = ((frame + slot) & 7) + 1
  local atlas_x<const> = 512 + (slot & 1) * config.word_width
  local atlas_y<const> = 256 + (slot >> 1) * config.height
  imgdec.upload(frame_sources[image], frame_words[image], config.texture_words, config.clut_words,
   gp0.pair16(atlas_x, atlas_y), gp0.pair16(config.word_width, config.height), gp0.pair16(512 + slot * 16, 768))
  dma.wait1_idle()
  stream_uploads = stream_uploads + 1
 end

 gpu.clear_color(0, 0x00f00140, 0xff101820)
 for slot = 0, config.uploads - 1 do
  local atlas_x<const> = 512 + (slot & 1) * config.word_width
  local atlas_y<const> = 256 + (slot >> 1) * config.height
  local x = (320 - config.width) // 2
  local y = (240 - config.height) // 2
  if config.uploads > 1 then
   x = 32 + (slot & 1) * 128
   y = (slot >> 1) * 112
  end
  if config.palette4 then
   gpu.draw_palette4_textured_rect_color(atlas_x, 512 + slot * 16, 768, 0, atlas_y,
    x, y, config.width, config.height, 0xffffffff, 0, 0)
  else
   gpu.draw_direct16_textured_rect_color(atlas_x, atlas_y,
    x, y, config.width, config.height, 0xffffffff, 0, 0)
  end
 end
 for index = 1, config.actors do
  local actor<const> = actors[index]
  local x = actor.x + actor.dx
  if x < 0 or x > 312 then
   actor.dx = -actor.dx
   x = actor.x + actor.dx
  end
  actor.x = x
  stream_checksum = (stream_checksum + x) & 0x7fffffff
  gpu.fill_rect_color(x, actor.y, x + 4, actor.y + 4, 0xff40e080)
 end
 -- The binary counter is an explicit output-data contract, not incidental UI.
 -- Its low three bits must match the marker uploaded inside the first image.
 for bit = 0, 15 do
  local color = 0xff000000
  if (frame & (1 << bit)) ~= 0 then color = 0xffffffff end
  gpu.fill_rect_color(4 + bit * 3, 236, 6 + bit * 3, 240, color)
 end
 local previous_fence<const> = fence_sequence
 *gp0_port = gp0.irq_request
 repeat halt_until_irq until fence_sequence ~= previous_fence
 stream_completed_frames = frame + 1
 if stream_vblanks ~= started then stream_late_frames = stream_late_frames + 1 end
 if (stream_completed_frames % 1000) == 0 then
  print('STREAM', stream_vblanks, stream_completed_frames, stream_late_frames, stream_uploads, stream_checksum)
 end
end
