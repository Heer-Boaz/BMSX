local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visualcomponent<const> = require('cartlib/component/visualcomponent')

local tilelayercomponent<const> = {}
tilelayercomponent.__index = tilelayercomponent
setmetatable(tilelayercomponent, { __index = visualcomponent })

function tilelayercomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts), tilelayercomponent)
	self.imgids = {}
	self._sources = {}
	self.tile_count = 0
	self.columns = opts.columns or 1
	self.tile_size = opts.tile_size or 0
	local imgids<const> = opts.imgids
	if imgids then
		local tile_count<const> = opts.tile_count or #imgids
		for index = 1, tile_count do
			self:set_tile(index, imgids[index])
		end
		self.tile_count = tile_count
	end
	return self
end

function tilelayercomponent:set_tile(index, imgid)
	self.imgids[index] = imgid
	if imgid then
		self._sources[index] = image.resolve(imgid)
	else
		self._sources[index] = nil
	end
end

function tilelayercomponent:set_tile_count(tile_count)
	local imgids<const> = self.imgids
	local sources<const> = self._sources
	for index = tile_count + 1, self.tile_count do
		imgids[index] = nil
		sources[index] = nil
	end
	self.tile_count = tile_count
end

function tilelayercomponent:fill(imgid, tile_count, columns)
	local source<const> = image.resolve(imgid)
	local imgids<const> = self.imgids
	local sources<const> = self._sources
	for index = 1, tile_count do
		imgids[index] = imgid
		sources[index] = source
	end
	for index = tile_count + 1, self.tile_count do
		imgids[index] = nil
		sources[index] = nil
	end
	self.tile_count = tile_count
	self.columns = columns
end

function tilelayercomponent:set_indexed_tiles(indices, index_count, imgid)
	local source<const> = image.resolve(imgid)
	local imgids<const> = self.imgids
	local sources<const> = self._sources
	for index = 1, index_count do
		local tile_index<const> = indices[index]
		imgids[tile_index] = imgid
		sources[tile_index] = source
	end
end

function tilelayercomponent:draw(draw)
	local parent<const> = self.parent
	local sources<const> = self._sources
	local columns<const> = self.columns
	local tile_size<const> = self.tile_size
	local origin_x<const> = parent.x + self.offset_x + self.draw_offset_x
	local target_x = origin_x
	local target_y = parent.y + self.offset_y + self.draw_offset_y
	local column = 0
	for index = 1, self.tile_count do
		local source<const> = sources[index]
		if source then
			source:draw(draw, target_x, target_y, 0xffffffff, 0, gp0.draw_mode_blend_half)
		end
		column = column + 1
		if column == columns then
			column = 0
			target_x = origin_x
			target_y = target_y + tile_size
		else
			target_x = target_x + tile_size
		end
	end
end

return tilelayercomponent
