local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local castle_map<const> = require('castle/map')
local sources<const> = {
	normal = image.resolve('room_proxy'),
	current = image.resolve('room_proxy_red'),
	boss = image.resolve('room_proxy_blue'),
}
local map_widget<const> = {}

local draw_map<const> = function(component, draw)
	local owner<const> = component.parent
	local proxies<const> = castle_map.map_world_proxies[owner.castle.room.world_number]
	for i = 1, #proxies do
		local proxy<const> = proxies[i]
		local source
		if owner.highlight and proxy.room_number == owner.castle.current_room_number then
			source = sources.current
		elseif owner.highlight and proxy.is_boss_room and owner.player.status.inventory_items.lamp then
			source = sources.boss
		else
			source = sources.normal
		end
		source:blit(draw, owner.x + proxy.x * 8, owner.y + proxy.y * 4)
	end
end

function map_widget.register()
	prefab.define({ def_id = 'pietious.map', class = map_widget,
		components = { custom_visual_component.factory({ draw = draw_map }) },
		defaults = { highlight = true, visible = false } })
end

return map_widget
