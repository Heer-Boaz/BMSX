-- A Transform is this actual component identity, including its flat local and
-- derived-world coefficients. World owns installation, topology and retirement.
local affine2<const> = require('cartlib/math/affine2')
local base_component<const> = require('cartlib/component/base_component')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local transform_2d_component<const> = {
	family = affine2,
	is_spatial = true,
	unique = true,
	resolve_world = hierarchy.resolve,
	set_local_origin = hierarchy.write_origin2,
	set_world_origin = hierarchy.write_world_origin2,
}
transform_2d_component.__index = transform_2d_component
setmetatable(transform_2d_component, { __index = base_component })

local affine<const> = {
	set_local_affine = hierarchy.write_local2,
	set_world_affine = hierarchy.write_world2,
	set_local_trs = hierarchy.write_local_trs2,
	set_world_trs = hierarchy.write_world_trs2,
}
affine.__index = affine
setmetatable(affine, { __index = transform_2d_component })
transform_2d_component.affine = affine

local root_origin<const> = { set_world_origin = hierarchy.write_origin2 }
root_origin.__index = root_origin
setmetatable(root_origin, { __index = transform_2d_component })
transform_2d_component.root_origin = root_origin

function transform_2d_component.new(graph, owner, local_transform)
	local self<const> = setmetatable(hierarchy.create2(graph, owner,
		local_transform[1], local_transform[2], local_transform[3],
		local_transform[4], local_transform[5], local_transform[6]), affine)
	self.enabled = true
	self._attached = false
	self._bound = false
	return self
end

function root_origin.new(graph, owner, local_transform)
	local self<const> = setmetatable(hierarchy.create2(graph, owner,
		local_transform[1], local_transform[2], local_transform[3],
		local_transform[4], local_transform[5], local_transform[6]), root_origin)
	self._origin_only = true
	self.enabled = true
	self._attached = false
	self._bound = false
	return self
end

-- This is capability admission, not validation of an owned array format.
function root_origin.validate_local(local_transform)
	if local_transform[1] ~= 1 or local_transform[2] ~= 0
	or local_transform[3] ~= 0 or local_transform[4] ~= 1 then
		error('root_origin Transform2D requires an identity basis')
	end
end

function transform_2d_component:set_enabled(enabled)
	if not enabled then
		error('spatial capability cannot be disabled')
	end
	return self
end

function transform_2d_component:world_origin()
	hierarchy.resolve(self)
	return self.wox, self.woy
end

function transform_2d_component:transform_point(x, y)
	hierarchy.resolve(self)
	return affine2.transform_point(self, x, y)
end

function transform_2d_component:transform_vector(x, y)
	hierarchy.resolve(self)
	return affine2.transform_vector(self, x, y)
end

function transform_2d_component:inverse_transform_point(x, y)
	hierarchy.resolve(self)
	return affine2.inverse_transform_point(self, x, y)
end

function transform_2d_component:inverse_transform_vector(x, y)
	hierarchy.resolve(self)
	return affine2.inverse_transform_vector(self, x, y)
end

local origin_fields<const> = { 'ox', 'oy' }
local affine_fields<const> = { 'xx', 'xy', 'yx', 'yy', 'ox', 'oy' }
local protected<const> = {
	xx = true, xy = true, yx = true, yy = true, ox = true, oy = true,
	wxx = true, wxy = true, wyx = true, wyy = true, wox = true, woy = true,
	spatial_parent = true,
}
local origin_group<const> = {
	fields = origin_fields, members = origin_fields,
	write = hierarchy.write_origin2, phase = 'physical',
}
transform_2d_component.timeline_channels = {
	protected = protected, groups = { local_origin2 = origin_group },
}
affine.timeline_channels = {
	protected = protected,
	groups = {
		local_origin2 = origin_group,
		local_affine2 = { fields = affine_fields, members = affine_fields,
			write = hierarchy.write_local2, phase = 'physical' },
	},
}

return transform_2d_component
