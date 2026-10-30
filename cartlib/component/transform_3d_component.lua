-- One component table owns a complete 3D local affine, retained world affine,
-- revisions and forest links. Asset-node transforms remain with their assets.
local affine3<const> = require('cartlib/math/affine3')
local base_component<const> = require('cartlib/component/base_component')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local transform_3d_component<const> = {
	family = affine3,
	is_spatial = true,
	unique = true,
	resolve_world = hierarchy.resolve,
	set_local_origin = hierarchy.write_origin3,
	set_world_origin = hierarchy.write_world_origin3,
}
transform_3d_component.__index = transform_3d_component
setmetatable(transform_3d_component, { __index = base_component })

local affine<const> = {
	set_local_affine = hierarchy.write_local3,
	set_world_affine = hierarchy.write_world3,
	set_local_trs = hierarchy.write_local_trs3,
	set_world_trs = hierarchy.write_world_trs3,
}
affine.__index = affine
setmetatable(affine, { __index = transform_3d_component })
transform_3d_component.affine = affine

local root_origin<const> = { set_world_origin = hierarchy.write_origin3 }
root_origin.__index = root_origin
setmetatable(root_origin, { __index = transform_3d_component })
transform_3d_component.root_origin = root_origin

function transform_3d_component.new(graph, owner, local_transform)
	local self<const> = setmetatable(hierarchy.create3(graph, owner,
		local_transform[1], local_transform[2], local_transform[3],
		local_transform[4], local_transform[5], local_transform[6],
		local_transform[7], local_transform[8], local_transform[9],
		local_transform[10], local_transform[11], local_transform[12]), affine)
	self.enabled = true
	self._attached = false
	self._bound = false
	return self
end

function root_origin.new(graph, owner, local_transform)
	local self<const> = setmetatable(hierarchy.create3(graph, owner,
		local_transform[1], local_transform[2], local_transform[3],
		local_transform[4], local_transform[5], local_transform[6],
		local_transform[7], local_transform[8], local_transform[9],
		local_transform[10], local_transform[11], local_transform[12]), root_origin)
	self._origin_only = true
	self.enabled = true
	self._attached = false
	self._bound = false
	return self
end

function root_origin.validate_local(local_transform)
	if local_transform[1] ~= 1 or local_transform[2] ~= 0 or local_transform[3] ~= 0
	or local_transform[4] ~= 0 or local_transform[5] ~= 1 or local_transform[6] ~= 0
	or local_transform[7] ~= 0 or local_transform[8] ~= 0 or local_transform[9] ~= 1 then
		error('root_origin Transform3D requires an identity basis')
	end
end

function transform_3d_component:set_enabled(enabled)
	if not enabled then
		error('spatial capability cannot be disabled')
	end
	return self
end

local origin_fields<const> = { 'ox', 'oy', 'oz' }
local affine_fields<const> = { 'xx','xy','xz','yx','yy','yz','zx','zy','zz','ox','oy','oz' }
local protected<const> = {
	xx = true, xy = true, xz = true, yx = true, yy = true, yz = true,
	zx = true, zy = true, zz = true, ox = true, oy = true, oz = true,
	wxx = true, wxy = true, wxz = true, wyx = true, wyy = true, wyz = true,
	wzx = true, wzy = true, wzz = true, wox = true, woy = true, woz = true,
	spatial_parent = true,
}
local origin_group<const> = {
	fields = origin_fields, members = origin_fields,
	write = hierarchy.write_origin3, phase = 'physical',
}
transform_3d_component.timeline_channels = {
	protected = protected, groups = { local_origin3 = origin_group },
}
affine.timeline_channels = {
	protected = protected,
	groups = {
		local_origin3 = origin_group,
		local_affine3 = { fields = affine_fields, members = affine_fields,
			write = hierarchy.write_local3, phase = 'physical' },
	},
}

return transform_3d_component
