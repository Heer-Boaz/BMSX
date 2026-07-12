local spriteobject<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/index').instance

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return oget('pietolon') ~= nil
end

function __bmsx_host_test.setup()
	add_space('z_order_test')
	set_space('z_order_test')
	local high<const> = spriteobject.new({ id = 'z_order_high' })
	world:spawn(high, { x = 80, y = 80, z = 200 })
	high:gfx('room_proxy_red')
	local low<const> = spriteobject.new({ id = 'z_order_low' })
	world:spawn(low, { x = 80, y = 80, z = 10 })
	low:gfx('room_proxy_blue')
end

function __bmsx_host_test.update(frame)
	local components<const> = world.active_space.active_components_by_type.spritecomponent
	if frame == 4 then
		assert(components[1].parent.id == 'z_order_low')
		assert(components[2].parent.id == 'z_order_high')
		return host.capture('high_front')
	end
	if frame == 5 then
		world:get('z_order_high').z = 0
		world:get('z_order_low').z = 300
	end
	if frame == 8 then
		assert(components[1].parent.id == 'z_order_high')
		assert(components[2].parent.id == 'z_order_low')
		return host.capture('low_front')
	end
	return frame >= 9
end
