-- The actual object owns local geometry, semantic editing channels, retained
-- world geometry and hierarchy links. There is no separately allocated pose.
local world_object<const> = require('cartlib/world/world_object')
local affine<const> = require('cartlib/math/affine3')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local object_3d<const> = { _family = affine }
object_3d.__index = object_3d
setmetatable(object_3d, { __index = world_object })

function object_3d._compile_pose(destination, defaults, source)
	local transform<const> = source and source.transform
	if transform ~= nil then
		destination.xx, destination.xy, destination.xz = transform.xx, transform.xy, transform.xz
		destination.yx, destination.yy, destination.yz = transform.yx, transform.yy, transform.yz
		destination.zx, destination.zy, destination.zz = transform.zx, transform.zy, transform.zz
		destination.ox, destination.oy, destination.oz = transform.ox, transform.oy, transform.oz
		destination._semantic_flags = 0
	elseif defaults ~= nil then
		destination.xx, destination.xy, destination.xz = defaults.xx, defaults.xy, defaults.xz
		destination.yx, destination.yy, destination.yz = defaults.yx, defaults.yy, defaults.yz
		destination.zx, destination.zy, destination.zz = defaults.zx, defaults.zy, defaults.zz
		destination.ox, destination.oy, destination.oz = defaults.ox, defaults.oy, defaults.oz
		destination._rotation_x, destination._rotation_y, destination._rotation_z, destination._rotation_w = defaults._rotation_x, defaults._rotation_y, defaults._rotation_z, defaults._rotation_w
		destination._scale_x, destination._scale_y, destination._scale_z = defaults._scale_x, defaults._scale_y, defaults._scale_z
		destination._semantic_flags = defaults._semantic_flags
	else
		affine.write_trs(destination, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1)
	end
	if source == nil then return true end
	local position<const> = source.position
	if position ~= nil then
		if position.x ~= nil then destination.ox = position.x end
		if position.y ~= nil then destination.oy = position.y end
		if position.z ~= nil then destination.oz = position.z end
	end
	local rotation<const> = source.rotation
	local scale<const> = source.scale
	local sx, sy, sz
	if scale ~= nil then sx, sy, sz = scale.x, scale.y, scale.z end
	if rotation == nil and sx == nil and sy == nil and sz == nil then return true end
	local qx, qy, qz, qw
	if rotation ~= nil then
		qx, qy, qz, qw = rotation.x, rotation.y, rotation.z, rotation.w
	else
		qx, qy, qz, qw = affine.rotation(destination)
		if qx == nil then return false end
	end
	if sx == nil or sy == nil or sz == nil then
		local inherited_x<const>, inherited_y<const>, inherited_z<const> = affine.scale(destination)
		if sx == nil then sx = inherited_x end
		if sy == nil then sy = inherited_y end
		if sz == nil then sz = inherited_z end
	end
	affine.write_trs(destination, destination.ox, destination.oy, destination.oz, qx, qy, qz, qw, sx, sy, sz)
	return true
end

object_3d._initialize_transform = hierarchy.initialize3

object_3d.set_position = hierarchy.write_origin3
object_3d.set_global_position = hierarchy.write_world_origin3
object_3d.set_transform = hierarchy.write_local3
object_3d.set_global_transform = hierarchy.write_world3
object_3d.set_pose = hierarchy.write_local_trs3
object_3d.get_rotation = affine.rotation
object_3d.get_scale = affine.scale

function object_3d:get_position()
	return self.ox, self.oy, self.oz
end

function object_3d:get_global_position()
	hierarchy.resolve(self)
	return self.wox, self.woy, self.woz
end

function object_3d:get_transform()
	return self.xx, self.xy, self.xz, self.yx, self.yy, self.yz, self.zx, self.zy, self.zz, self.ox, self.oy, self.oz
end

function object_3d:get_global_transform()
	hierarchy.resolve(self)
	return self.wxx, self.wxy, self.wxz, self.wyx, self.wyy, self.wyz, self.wzx, self.wzy, self.wzz, self.wox, self.woy, self.woz
end

-- Explicit rotation/scale edits replace this local basis with R*diag(S).
-- Reading or reparenting a sheared affine never performs this projection.
function object_3d:set_rotation(qx, qy, qz, qw)
	local sx<const>, sy<const>, sz<const> = affine.scale(self)
	return hierarchy.write_basis_trs3(self, qx, qy, qz, qw, sx, sy, sz)
end

function object_3d:set_scale(sx, sy, sz)
	local qx<const>, qy<const>, qz<const>, qw<const> = affine.rotation(self)
	if qx == nil then return false end
	return hierarchy.write_basis_trs3(self, qx, qy, qz, qw, sx, sy, sz)
end

function object_3d:set_global_pose(x, y, z, qx, qy, qz, qw, sx, sy, sz)
	if self.parent == nil then return hierarchy.write_local_trs3(self, x, y, z, qx, qy, qz, qw, sx, sy, sz) end
	return hierarchy.write_world_trs3(self, x, y, z, qx, qy, qz, qw, sx, sy, sz)
end

function object_3d:transform_point(x, y, z)
	hierarchy.resolve(self)
	return affine.transform_point(self, x, y, z)
end

function object_3d:transform_vector(x, y, z)
	hierarchy.resolve(self)
	return affine.transform_vector(self, x, y, z)
end

function object_3d:inverse_transform_point(x, y, z)
	hierarchy.resolve(self)
	return affine.inverse_transform_point(self, x, y, z)
end

function object_3d:inverse_transform_vector(x, y, z)
	hierarchy.resolve(self)
	return affine.inverse_transform_vector(self, x, y, z)
end

local protected<const> = {
	xx = true, xy = true, xz = true, yx = true, yy = true, yz = true,
	zx = true, zy = true, zz = true, ox = true, oy = true, oz = true,
	wxx = true, wxy = true, wxz = true, wyx = true, wyy = true, wyz = true,
	wzx = true, wzy = true, wzz = true, wox = true, woy = true, woz = true,
	_rotation_x = true, _rotation_y = true, _rotation_z = true, _rotation_w = true,
	_scale_x = true, _scale_y = true, _scale_z = true, _semantic_flags = true, parent = true,
}
object_3d.timeline_channels = {
	protected = protected,
	groups = {
		position3 = { fields = { 'x', 'y', 'z' }, members = { 'ox', 'oy', 'oz' }, write = hierarchy.write_origin3, phase = 'physical' },
		transform3 = { fields = { 'xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz', 'ox', 'oy', 'oz' },
			members = { 'xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz', 'ox', 'oy', 'oz' },
			write = hierarchy.write_local3, phase = 'physical' },
	},
}

return object_3d
