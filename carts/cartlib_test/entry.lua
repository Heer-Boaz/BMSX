module<entry>
local gx_display<const> = require('cartlib/gx/display')
local gx_gte<const> = require('cartlib/gx/gte')
local vblank<const> = require('cartlib/gx/vblank')
local gx_gte_plus<const>: *word[10] = gx_gte.plus
gx_display.reset_320x240()
local irq_module<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
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

cartlib_test_ready = false
world:clear()
irq_module.register(irq_source.vblank, vblank.on_irq)
vblank.wait()
cartlib_test_ready = true

while true do
	world:update()
	vblank.wait()
	world:render()
end
