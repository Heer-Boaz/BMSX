-- One intrinsic spatial object. Its local affine is the geometric pose;
-- semantic editing channels and the full world affine belong to this same owner.
local world_object<const> = require('cartlib/world/world_object')
local affine<const> = require('cartlib/math/affine2')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local object_2d<const> = { _family = affine }
object_2d.__index = object_2d
setmetatable(object_2d, { __index = world_object })

function object_2d._compile_pose(destination, defaults, source)
	local transform<const> = source and source.transform
	if transform ~= nil then
		destination.xx, destination.xy, destination.yx, destination.yy = transform.xx, transform.xy, transform.yx, transform.yy
		destination.ox, destination.oy = transform.ox, transform.oy
		destination._semantic_flags = 0
	elseif defaults ~= nil then
		destination.xx, destination.xy, destination.yx, destination.yy = defaults.xx, defaults.xy, defaults.yx, defaults.yy
		destination.ox, destination.oy = defaults.ox, defaults.oy
		destination._rotation = defaults._rotation
		destination._scale_x, destination._scale_y = defaults._scale_x, defaults._scale_y
		destination._skew = defaults._skew
		destination._semantic_flags = defaults._semantic_flags
	else
		affine.write_trs(destination, 0, 0, 0, 1, 1, 0)
	end
	if source == nil then return true end
	local position<const> = source.position
	if position ~= nil then
		if position.x ~= nil then destination.ox = position.x end
		if position.y ~= nil then destination.oy = position.y end
	end
	local rotation = source.rotation
	local scale<const> = source.scale
	local sx, sy
	if scale ~= nil then sx, sy = scale.x, scale.y end
	local skew = source.skew
	if rotation == nil and sx == nil and sy == nil and skew == nil then return true end
	if rotation == nil then rotation = affine.rotation(destination) end
	if rotation == nil then return false end
	if skew == nil then skew = affine.skew(destination) end
	if skew == nil then return false end
	if sx == nil or sy == nil then
		local inherited_x<const>, inherited_y<const> = affine.scale(destination)
		if sx == nil then sx = inherited_x end
		if sy == nil then sy = inherited_y end
	end
	affine.write_trs(destination, destination.ox, destination.oy, rotation, sx, sy, skew)
	return true
end

object_2d._initialize_transform = hierarchy.initialize2

object_2d.set_position = hierarchy.write_origin2
object_2d.set_global_position = hierarchy.write_world_origin2
object_2d.set_transform = hierarchy.write_local2
object_2d.set_global_transform = hierarchy.write_world2
object_2d.set_pose = hierarchy.write_local_trs2
object_2d.get_rotation = affine.rotation
object_2d.get_scale = affine.scale
object_2d.get_skew = affine.skew

function object_2d:get_position()
	return self.ox, self.oy
end

function object_2d:get_global_position()
	hierarchy.resolve(self)
	return self.wox, self.woy
end

function object_2d:get_transform()
	return self.xx, self.xy, self.yx, self.yy, self.ox, self.oy
end

function object_2d:get_global_transform()
	hierarchy.resolve(self)
	return self.wxx, self.wxy, self.wyx, self.wyy, self.wox, self.woy
end

function object_2d:set_rotation(rotation)
	local skew<const> = affine.skew(self)
	if skew == nil then return false end
	local sx<const>, sy<const> = affine.scale(self)
	return hierarchy.write_basis_trs2(self, rotation, sx, sy, skew)
end

function object_2d:set_scale(sx, sy)
	local rotation<const> = affine.rotation(self)
	if rotation == nil then return false end
	local skew<const> = affine.skew(self)
	if skew == nil then return false end
	return hierarchy.write_basis_trs2(self, rotation, sx, sy, skew)
end

function object_2d:set_skew(skew)
	local rotation<const> = affine.rotation(self)
	if rotation == nil then return false end
	local sx<const>, sy<const> = affine.scale(self)
	return hierarchy.write_basis_trs2(self, rotation, sx, sy, skew)
end

function object_2d:set_global_pose(x, y, rotation, sx, sy, skew)
	if self.parent == nil then return hierarchy.write_local_trs2(self, x, y, rotation, sx, sy, skew) end
	return hierarchy.write_world_trs2(self, x, y, rotation, sx, sy, skew)
end

function object_2d:transform_point(x, y)
	hierarchy.resolve(self)
	return affine.transform_point(self, x, y)
end

function object_2d:transform_vector(x, y)
	hierarchy.resolve(self)
	return affine.transform_vector(self, x, y)
end

function object_2d:inverse_transform_point(x, y)
	hierarchy.resolve(self)
	return affine.inverse_transform_point(self, x, y)
end

function object_2d:inverse_transform_vector(x, y)
	hierarchy.resolve(self)
	return affine.inverse_transform_vector(self, x, y)
end

local protected<const> = {
	xx = true, xy = true, yx = true, yy = true, ox = true, oy = true,
	wxx = true, wxy = true, wyx = true, wyy = true, wox = true, woy = true,
	_rotation = true, _scale_x = true, _scale_y = true, _skew = true,
	_semantic_flags = true, parent = true,
}
object_2d.timeline_channels = {
	protected = protected,
	groups = {
		position2 = { fields = { 'x', 'y' }, members = { 'ox', 'oy' }, write = hierarchy.write_origin2, phase = 'physical' },
		transform2 = { fields = { 'xx', 'xy', 'yx', 'yy', 'ox', 'oy' },
			members = { 'xx', 'xy', 'yx', 'yy', 'ox', 'oy' }, write = hierarchy.write_local2, phase = 'physical' },
	},
}

return object_2d
