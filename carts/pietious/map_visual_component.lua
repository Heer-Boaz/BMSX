local image<const> = require('cartlib/gx/image')
local visual_2d<const> = require('cartlib/component/visual_2d_component')
local gp0<const> = require('cartlib/gx/gp0')
local castle_map<const> = require('castle/map')
local sources<const> = {
	normal = image.resolve('room_proxy'),
	current = image.resolve('room_proxy_red'),
	boss = image.resolve('room_proxy_blue'),
}
local map_visual<const> = {}
map_visual.__index = map_visual
setmetatable(map_visual, { __index = visual_2d })

function map_visual.new(context)
	local self<const> = visual_2d.new(context, 'map')
	setmetatable(self, map_visual)
	self.highlight = true
	self:set_draw_function(map_visual.draw_map)
	return self
end

function map_visual:draw_map(draw)
	self:resolve_pose()
	local owner<const> = self.owner
	local proxies<const> = castle_map.map_world_proxies[owner.castle.room.world_number]
	local current_room<const> = owner.castle.current_room_number
	local show_boss<const> = self.highlight and owner.player.status.inventory_items.lamp
	if self._translation_only then
		for i = 1, #proxies do
			local proxy<const> = proxies[i]
			local source = sources.normal
			if self.highlight and proxy.room_number == current_room then source = sources.current
			elseif show_boss and proxy.is_boss_room then source = sources.boss end
			source:blit(draw, self.wox + proxy.x * 8, self.woy + proxy.y * 4)
		end
		return
	end
	for i = 1, #proxies do
		local proxy<const> = proxies[i]
		local source = sources.normal
		if self.highlight and proxy.room_number == current_room then source = sources.current
		elseif show_boss and proxy.is_boss_room then source = sources.boss end
		local x<const>, y<const> = proxy.x * 8, proxy.y * 4
		source:draw_affine(draw,
			self.wox + self.wxx * x + self.wyx * y, self.woy + self.wxy * x + self.wyy * y,
			self.wxx * source.width, self.wxy * source.width,
			self.wyx * source.height, self.wyy * source.height,
			0, 0xffffffff, gp0.draw_mode_blend_half)
	end
end

return map_visual
