module<entry>
local gx_display<const> = require('cartlib/gx/display')
local image<const> = require('cartlib/gx/image')
local gx_texture<const> = require('cartlib/gx/texture')
local texture_layout<const> = require('bmsx/gx_texture_layout')
gx_display.reset_256x192()
local aem<const> = require('cartlib/aem')
local collision2d<const> = require('cartlib/collision2d')
local input<const> = require('cartlib/input/player')
input.add_player(1)
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch
local render<const> = require('cartlib/render/renderer')
local world_instance<const> = require('cartlib/world/world').instance
require('constants')
local game_session<const> = require('game_session')

local irq_mask_addr<const> = 0x08000008
local irq_geo_done_error<const> = 0x0018
local irq_apu<const> = 0x0020
local framebuffer_front<const> = texture_layout.framebuffer_front
local framebuffer_back<const> = texture_layout.framebuffer_back

mem[irq_mask_addr] = 0
local function bind_runtime<init>()
	irq_module.register(irq_geo_done_error, collision2d.on_geo_irq)
	irq_module.register(irq_apu, aem.on_apu_irq)
	aem.rebind()
end

mem[irq_mask_addr] = irq_geo_done_error | irq_apu
local renderer<const> = render.new_page_flipped(
	world_instance,
	framebuffer_front,
	framebuffer_back,
	0xff000000)
gx_texture.upload(image.load('pietolon_stand_r').texture, texture_layout.gameplay, texture_layout.gameplay_clut)
game_session.start('title_screen')
mem[0x08000064] = 0x00000001
renderer:wait_vblank()

while true do
	input.update()
	world_instance:update()

	renderer:wait_vblank()
	renderer:render()

	mem[0x08000064] = 0x00000001
	renderer:present()
end
