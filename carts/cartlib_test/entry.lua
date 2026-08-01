module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
local gx_gte<const> = require('cartlib/gx/gte')
local gx_gte_plus<const>: *word[10] = gx_gte.plus
gx_display.reset_320x240()
local ecs_pipeline_registry<const> = require('cartlib/ecs/pipeline').defaultecspipelineregistry
local visual_render_system<const> = require('cartlib/ecs/systems/visual_render')
local input<const> = require('cartlib/input/player')
local irq_module<const> = require('cartlib/irq')
local world<const> = require('cartlib/world/world').instance
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
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local framebuffer_size<const> = 320 | (240 << 16)
local vblank_count = 0
cartlib_test_ready = false

local pipeline_descriptors<const> = { visual_render_system }
local pipeline_spec<const> = { { ref = visual_render_system.id } }

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

irq_module.register(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

ecs_pipeline_registry:register_many(pipeline_descriptors)
world:clear()
ecs_pipeline_registry:build(world, pipeline_spec)
world:add_space('main')
world:set_space('main')
*irq_mask_register = irq_vblank
*input_control_register = 0x00000001
wait_vblank()
cartlib_test_ready = true

while true do
	input.update()
	world:update()
	wait_vblank()
	gx_gpu.clear_color(0, framebuffer_size, 0xff000000)
	world:draw()
	*input_control_register = 0x00000001
end
