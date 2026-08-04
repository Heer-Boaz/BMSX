module<entry>
local gx_display<const> = require('cartlib/gx/display')
local gx_gte<const> = require('cartlib/gx/gte')
local gx_gpu<const> = require('cartlib/gx/gpu')
local vblank<const> = require('cartlib/gx/vblank')
local gx_gte_plus<const>: *word[10] = gx_gte.plus
gx_display.reset_320x240()
local player_input<const> = require('cartlib/input/player')
local irq_module<const> = require('cartlib/irq')
local world_render<const> = require('cartlib/render/world')
local world<const> = require('cartlib/world/world')
irq = irq_module.dispatch

gx_gte_plus[gx_gte.plus_add_xy] = gx_gte.pack_i16_pair(1, 2)
gx_gte_plus[gx_gte.plus_add_z] = 3
gx_gte_plus[gx_gte.plus_mul_xy] = 0
gx_gte_plus[gx_gte.plus_mul_z] = 0
gx_gte_plus[gx_gte.plus_scalar] = 0
gx_gte_plus[gx_gte.plus_command] = gx_gte.plus_opcode_vmad3
gx_gte_plus[gx_gte.plus_add_xy] = gx_gte.pack_i16_pair(21, -11)
gx_gte_plus[gx_gte.plus_command] = gx_gte.plus_opcode_vmad3
while (gx_gte_plus[gx_gte.plus_cycles] & gx_gte.plus_cycles_busy) ~= 0 do
end
assert(
	gx_gte_plus[gx_gte.plus_result_xy] == gx_gte.pack_i16_pair(21, -11)
		and gx_gte_plus[gx_gte.plus_result_z] == 3,
	'GTE+ blocked command retry mismatch')
cartlib_test_gte_plus_interlock_ready = true

gx_gte_plus[gx_gte.plus_add_xy] = gx_gte.pack_i16_pair(10, -20)
gx_gte_plus[gx_gte.plus_add_z] = 30
gx_gte_plus[gx_gte.plus_mul_xy] = gx_gte.pack_i16_pair(8, 12)
gx_gte_plus[gx_gte.plus_mul_z] = gx_gte.pack_i16_pair(-4, 0)
gx_gte_plus[gx_gte.plus_scalar] = gx_gte.pack_i16_pair(-0x0800, 0)
gx_gte_plus[gx_gte.plus_command] = gx_gte.plus_opcode_vmad3
while (gx_gte_plus[gx_gte.plus_cycles] & gx_gte.plus_cycles_busy) ~= 0 do
end
local result_xy<const> = gx_gte_plus[gx_gte.plus_result_xy]
local result_z<const> = gx_gte_plus[gx_gte.plus_result_z]
cartlib_test_gte_plus_x = (result_xy & 0x00007fff) - (result_xy & 0x00008000)
cartlib_test_gte_plus_y = ((result_xy >> 16) & 0x00007fff) - ((result_xy >> 16) & 0x00008000)
cartlib_test_gte_plus_z = (result_z & 0x00007fff) - (result_z & 0x00008000)
assert(cartlib_test_gte_plus_x == 6 and cartlib_test_gte_plus_y == -26 and cartlib_test_gte_plus_z == 32, 'GTE+ firmware VMAD3 result mismatch')
assert(
	gx_gte_plus[gx_gte.plus_result_xy] == gx_gte.pack_i16_pair(6, -26)
		and gx_gte_plus[gx_gte.plus_result_z] == 32,
	'GTE+ result latches mismatch')
assert(
	gx_gte_plus[gx_gte.plus_flag] == 0
		and gx_gte_plus[gx_gte.plus_cycles] == gx_gte.plus_cycles_vmad3,
	'GTE+ completion latches mismatch')
cartlib_test_gte_plus_ready = true

local irq_mask_register<const>: *word = 0x08000008
local framebuffer<const> = 0
local framebuffer_size<const> = gx_display.size_word()
local clear_color<const> = 0xff000000
cartlib_test_ready = false
world.systems:replace({ player_input.ecs_system })
world:clear()
world:set_space('main')
irq_module.register(vblank.irq_mask, vblank.on_irq)
*irq_mask_register = vblank.irq_mask
gx_gpu.draw_target(framebuffer, framebuffer_size)
gx_gpu.clear_color(framebuffer, framebuffer_size, clear_color)
player_input.arm_vblank_sample()
vblank.wait()
cartlib_test_ready = true

while true do
	world:update()
	vblank.wait()
	world_render.draw(world, framebuffer, framebuffer_size, clear_color)
	player_input.arm_vblank_sample()
end
