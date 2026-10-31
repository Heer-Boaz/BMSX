-- A model is placement data, not a visual callback. One camera pass consumes
-- the active component view and orders triangles across all model instances.
local base_component<const> = require('cartlib/component/base_component')
local component_inputs<const> = require('cartlib/world/component_inputs')
local affine3<const> = require('cartlib/math/affine3')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')
local static_model<const> = require('cartlib/gx/static_model')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local model_component<const> = {}
model_component.__index = model_component
setmetatable(model_component, { __index = base_component })

function model_component.new(context, id_local, defaults, default_source)
	id_local = id_local or 'model'
	local input<const> = context.initial[id_local] or component_inputs.empty
	local definition<const> = defaults or component_inputs.empty
	local self<const> = setmetatable(base_component.new(context), model_component)
	self.id_local = id_local
	local spatial<const> = context.owner.spatial
	self.spatial = spatial
	local enabled = input.enabled
	if enabled == nil then enabled = definition.enabled end
	self.enabled = enabled == nil or enabled
	local visible = input.visible
	if visible == nil then visible = definition.visible end
	self.visible = visible == nil or visible
	local attachment<const> = input.attachment_affine or definition.attachment_affine or affine3.identity
	local presentation<const> = input.presentation_affine or definition.presentation_affine or affine3.identity
	self.attachment_xx = attachment[1]
	self.presentation_xx = presentation[1]
	self.attachment_xy = attachment[2]
	self.presentation_xy = presentation[2]
	self.attachment_xz = attachment[3]
	self.presentation_xz = presentation[3]
	self.attachment_yx = attachment[4]
	self.presentation_yx = presentation[4]
	self.attachment_yy = attachment[5]
	self.presentation_yy = presentation[5]
	self.attachment_yz = attachment[6]
	self.presentation_yz = presentation[6]
	self.attachment_zx = attachment[7]
	self.presentation_zx = presentation[7]
	self.attachment_zy = attachment[8]
	self.presentation_zy = presentation[8]
	self.attachment_zz = attachment[9]
	self.presentation_zz = presentation[9]
	self.attachment_ox = attachment[10]
	self.presentation_ox = presentation[10]
	self.attachment_oy = attachment[11]
	self.presentation_oy = presentation[11]
	self.attachment_oz = attachment[12]
	self.presentation_oz = presentation[12]
	self._pose_flags = 3
	self._owner_basis_revision, self._owner_origin_revision = -1, -1
	self._render_revision = 0
	if input.model_id ~= nil or input.scene_index ~= nil or default_source == nil then
		self._source = static_model.resolve(input.model_id or definition.model_id, input.scene_index or definition.scene_index)
	else
		self._source = default_source
	end
	self.model_id = input.model_id or definition.model_id
	self.scene_index = self._source.scene_index
	return self
end

function model_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	local source<const> = static_model.resolve(defaults.model_id, defaults.scene_index)
	return function(context, id_local)
		return model_component.new(context, id_local or defaults.id_local, defaults, source)
	end
end

function model_component:set_model(model_id, scene_index)
	local source<const> = static_model.resolve(model_id, scene_index)
	if source == self._source then return false end
	self._source, self.model_id, self.scene_index = source, model_id, source.scene_index
	self._render_revision = self._render_revision + 1
	return true
end

function model_component:set_attachment_affine(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	self.attachment_xx = xx
	self.attachment_xy = xy
	self.attachment_xz = xz
	self.attachment_yx = yx
	self.attachment_yy = yy
	self.attachment_yz = yz
	self.attachment_zx = zx
	self.attachment_zy = zy
	self.attachment_zz = zz
	self.attachment_ox = ox
	self.attachment_oy = oy
	self.attachment_oz = oz
	self._pose_flags = 3
	return self
end

function model_component:set_attachment_origin(x, y, z)
	self.attachment_ox, self.attachment_oy, self.attachment_oz = x, y, z
	self._pose_flags = self._pose_flags | 2
	return self
end

function model_component:set_presentation_affine(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	self.presentation_xx = xx
	self.presentation_xy = xy
	self.presentation_xz = xz
	self.presentation_yx = yx
	self.presentation_yy = yy
	self.presentation_yz = yz
	self.presentation_zx = zx
	self.presentation_zy = zy
	self.presentation_zz = zz
	self.presentation_ox = ox
	self.presentation_oy = oy
	self.presentation_oz = oz
	self._pose_flags = 3
	return self
end

function model_component:set_presentation_origin(x, y, z)
	self.presentation_ox, self.presentation_oy, self.presentation_oz = x, y, z
	self._pose_flags = self._pose_flags | 2
	return self
end

-- Own placement changes rebuild attachment × presentation. Existing hierarchy
-- revisions select world basis/origin work independently; a clean read is free
-- of affine composition, allocation and vertex work.
function model_component:resolve_pose()
	local spatial<const> = self.spatial
	hierarchy.resolve(spatial)
	local flags<const> = self._pose_flags
	local basis_revision<const>, origin_revision<const> = spatial._basis_revision, spatial._origin_revision
	local parent_basis_changed<const> = basis_revision ~= self._owner_basis_revision
	local basis_changed<const> = parent_basis_changed or (flags & 1) ~= 0
	local origin_changed<const> = parent_basis_changed or origin_revision ~= self._owner_origin_revision or (flags & 2) ~= 0
	if not basis_changed and not origin_changed then return self end
	if flags ~= 0 then
		local axx<const>,axy<const>,axz<const> = self.attachment_xx,self.attachment_xy,self.attachment_xz
		local ayx<const>,ayy<const>,ayz<const> = self.attachment_yx,self.attachment_yy,self.attachment_yz
		local azx<const>,azy<const>,azz<const> = self.attachment_zx,self.attachment_zy,self.attachment_zz
		if (flags & 1) ~= 0 then
			local pxx<const>,pxy<const>,pxz<const> = self.presentation_xx,self.presentation_xy,self.presentation_xz
			local pyx<const>,pyy<const>,pyz<const> = self.presentation_yx,self.presentation_yy,self.presentation_yz
			local pzx<const>,pzy<const>,pzz<const> = self.presentation_zx,self.presentation_zy,self.presentation_zz
			self.xx,self.xy,self.xz = axx*pxx+ayx*pxy+azx*pxz, axy*pxx+ayy*pxy+azy*pxz, axz*pxx+ayz*pxy+azz*pxz
			self.yx,self.yy,self.yz = axx*pyx+ayx*pyy+azx*pyz, axy*pyx+ayy*pyy+azy*pyz, axz*pyx+ayz*pyy+azz*pyz
			self.zx,self.zy,self.zz = axx*pzx+ayx*pzy+azx*pzz, axy*pzx+ayy*pzy+azy*pzz, axz*pzx+ayz*pzy+azz*pzz
		end
		if (flags & 2) ~= 0 then
			local px<const>,py<const>,pz<const> = self.presentation_ox,self.presentation_oy,self.presentation_oz
			self.ox = axx*px+ayx*py+azx*pz+self.attachment_ox
			self.oy = axy*px+ayy*py+azy*pz+self.attachment_oy
			self.oz = axz*px+ayz*py+azz*pz+self.attachment_oz
		end
	end
	affine3.evaluate(self, spatial, basis_changed, origin_changed)
	self._owner_basis_revision, self._owner_origin_revision = basis_revision, origin_revision
	self._pose_flags = 0
	self._render_revision = self._render_revision + 1
	return self
end

return model_component
