local visual_2d<const> = require('cartlib/component/visual_2d_component')
local image<const> = require('cartlib/gx/image')
local affine_batch<const> = require('cartlib/gx/affine_batch')
require('constants')

local death_visual<const> = {}
death_visual.__index = death_visual
setmetatable(death_visual, { __index = visual_2d })
local images<const> = {}
for index = 1, 8 do
	images[index] = image.resolve('world1_daemon_death_' .. tostring(index))
end

local draw_parity<const> = function(self, draw, tile, parity)
	local xx, xy = self.wxx, self.wxy
	local step = room_tile_size2
	local tile_shift = 0
	if self.owner.direction == 'left' then
		xx, xy = -xx, -xy
		step = -step
		tile_shift = room_tile_size
	end
	for row = 0, 3 do
		local x<const> = ((row + parity) & 1) * room_tile_size + tile_shift
		local y<const> = row * room_tile_size
		affine_batch.repeated_image(draw, tile, 0, 4, step, 0,
			xx, xy, self.wyx, self.wyy,
			self.wox + self.wxx * x + self.wyx * y,
			self.woy + self.wxy * x + self.wyy * y, 0xffffffff)
	end
end

function death_visual:draw_overlay(draw)
	self:resolve_pose()
	local stage<const> = self.stage
	if stage <= 8 then
		draw_parity(self, draw, images[stage], 0)
	else
		draw_parity(self, draw, images[8], 0)
		draw_parity(self, draw, images[stage - 8], 1)
	end
end

local death_profile<const> = { order = 251 }

function death_visual.new(owner)
	local self<const> = visual_2d.new(owner, death_profile, 'death')
	setmetatable(self, death_visual)
	self.stage = 1
	return self
end

return death_visual
