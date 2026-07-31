module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_gte<const> = require('cartlib/gx/gte')
local gx_gte_plus<const>: *word[10] = gx_gte.plus
gx_gpu.reset_320x240()
local ecs_builtin<const> = require('cartlib/ecs/builtin')
local ecs_pipeline_registry<const> = require('cartlib/ecs/pipeline').defaultecspipelineregistry
local cart_input<const> = require('cartlib/input/player')
local irq_module<const> = require('cartlib/irq')
local world<const> = require('cartlib/world/index').instance
irq = irq_module.dispatch

local gx_gte_plus_vmad3<const> = gx_gte.plus_opcode_vmad3
gx_gte_plus[0] = 0x00020001
gx_gte_plus[1] = 3
gx_gte_plus[2] = 0
gx_gte_plus[3] = 0
gx_gte_plus[4] = 0
gx_gte_plus[8] = gx_gte_plus_vmad3
gx_gte_plus[0] = 0xfff50015
gx_gte_plus[8] = gx_gte_plus_vmad3
while (gx_gte_plus[9] & 0x80000000) ~= 0 do
end
assert(gx_gte_plus[5] == 0xfff50015 and gx_gte_plus[6] == 3, 'GTE+ blocked command retry mismatch')
cartlib_test_gte_plus_interlock_ready = true

cartlib_test_gte_plus_x, cartlib_test_gte_plus_y, cartlib_test_gte_plus_z = gx_gte.vmad3(10, -20, 30, 8, 12, -4, -0x0800)
assert(cartlib_test_gte_plus_x == 6 and cartlib_test_gte_plus_y == -26 and cartlib_test_gte_plus_z == 32, 'GTE+ firmware VMAD3 result mismatch')
assert(gx_gte_plus[5] == 0xffe60006 and gx_gte_plus[6] == 32, 'GTE+ result latches mismatch')
assert(gx_gte_plus[7] == 0 and gx_gte_plus[9] == 5, 'GTE+ completion latches mismatch')
cartlib_test_gte_plus_ready = true

local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0
cartlib_test_ready = false

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

irq_module.register(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

ecs_builtin.register_builtin_ecs()
world:clear()
ecs_pipeline_registry:build(world, ecs_builtin.default_pipeline_spec)
world:add_space('main')
world:set_space('main')
*irq_mask_register = irq_vblank
*input_control_register = 0x00000001
wait_vblank()
cartlib_test_ready = true

while true do
	cart_input.update()
	world:update()
	wait_vblank()
	gx_gpu.clear_color(0xff000000)
	world:draw()
	*input_control_register = 0x00000001
end
