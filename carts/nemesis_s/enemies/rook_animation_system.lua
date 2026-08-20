local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')
require('constants')

local rook_animation_system<const> = {
	current_imgid = assets_rook_1,
}
rook_animation_system.__index = rook_animation_system
setmetatable(rook_animation_system, { __index = base_system })
rook_animation_system.tick = {
	group = tick_group.animation,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}

local frame_duration_ms<const> = clock.frame_milliseconds()
local images<const> = {
	assets_rook_1,
	assets_rook_2,
	assets_rook_3,
}

function rook_animation_system.new(world)
	local self<const> = setmetatable(base_system.new(rook_animation_system.tick), rook_animation_system)
	self._rook_view = world:active_definition_view(ids_rook_def)
	self.elapsed_ms = 0
	self.frame = 1
	return self
end

function rook_animation_system:update()
	local elapsed<const> = self.elapsed_ms + frame_duration_ms
	if elapsed < rook_animation_frame_ms then
		self.elapsed_ms = elapsed
		return
	end
	self.elapsed_ms = elapsed - rook_animation_frame_ms
	local frame<const> = (self.frame % #images) + 1
	self.frame = frame
	local imgid<const> = images[frame]
	rook_animation_system.current_imgid = imgid
	local rooks<const> = self._rook_view.objects
	for rook_index = 1, #rooks do
		rooks[rook_index]:set_imgid(imgid)
	end
end

function rook_animation_system:clear()
	self.elapsed_ms = 0
	self.frame = 1
	rook_animation_system.current_imgid = assets_rook_1
end

return rook_animation_system
