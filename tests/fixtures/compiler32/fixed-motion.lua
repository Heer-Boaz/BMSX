require('base')
local velocity_system<const> = require('cartlib/physics/velocity_system')
local cases<const> = {
 { -1, 0, -1, 255 },
 { -128, 127, -1, 255 },
 { -256, 0, -1, 0 },
 { -257, 255, -1, 254 },
 { -513, 1, -2, 0 },
 { -512, 255, -2, 255 },
 { 1, 255, 1, 0 },
 { 128, 127, 0, 255 },
 { 256, 0, 1, 0 },
 { 511, 255, 2, 254 },
 { 0x80000000, 255, -8388608, 255 },
 { 2147483392, 255, 8388607, 255 },
}
for index = 1, #cases do
 local row<const> = cases[index]
 local other<const> = cases[#cases + 1 - index]
 local owner<const> = { _flags = 0, wox = 11, woy = -17 }
 local component<const> = {
  owner = owner, velocity_x = row[1], fraction_x = row[2],
  velocity_y = other[1], fraction_y = other[2],
  _write_world_origin = function(spatial, x, y)
   spatial.wox = x
   spatial.woy = y
   return true
  end,
 }
 local system<const> = {
  _fixed_point_component_view = { components = { component } },
  _ballistic_component_view = { components = {} },
 }
 velocity_system.update_fixed_point(system)
 assert(owner.wox == 11 + row[3] and owner.woy == -17 + other[3], 'signed Q8 displacement')
 assert(component.fraction_x == row[4] and component.fraction_y == other[4], 'retained Q8 fraction')
 assert(component.motion_committed)
end
local owner<const> = { _flags = 0, wox = 11, woy = -17 }
local component<const> = {
 owner = owner, velocity_x = -128, fraction_x = 0,
 velocity_y = 128, fraction_y = 255,
 acceleration_x = -1, acceleration_y = 1,
 _write_world_origin = function() return false end,
}
velocity_system.update_fixed_point({
 _fixed_point_component_view = { components = { component } },
 _ballistic_component_view = { components = { component } },
})
assert(not component.motion_committed and component.fraction_x == 0 and component.fraction_y == 255)
assert(owner.wox == 11 and owner.woy == -17)
assert(component.velocity_x == -129 and component.velocity_y == 129, 'acceleration follows movement')
return true
