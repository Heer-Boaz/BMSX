-- Visual placement is object-world * attachment-local * presentation-local.
-- The actual component owns every coefficient and cache; no matrix views or
-- second spatial nodes are allocated for geometry placement or animation.
local affine2<const> = require('cartlib/math/affine2')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')
local visual_component<const> = require('cartlib/component/visual_component')

local visual_2d_component<const> = {}
visual_2d_component.__index = visual_2d_component
setmetatable(visual_2d_component, { __index = visual_component })

local basis_dirty<const> = 1
local origin_dirty<const> = 2
local all_dirty<const> = basis_dirty | origin_dirty
local identity<const> = affine2.identity

function visual_2d_component.new(context, id_local, defaults)
	local self<const>, input<const> = visual_component.new(context, id_local, defaults)
	setmetatable(self, visual_2d_component)
	local spatial<const> = context.owner.spatial
	if spatial == nil or spatial._family ~= affine2 then
		error('2D visual requires its owner\'s Transform2D')
	end
	self.spatial = spatial
	local attachment<const> = input.attachment_affine
		or (defaults and defaults.attachment_affine) or identity
	local presentation<const> = input.presentation_affine
		or (defaults and defaults.presentation_affine) or identity
	self.attachment_xx = attachment[1]
	self.attachment_xy = attachment[2]
	self.attachment_yx = attachment[3]
	self.attachment_yy = attachment[4]
	self.attachment_ox = attachment[5]
	self.attachment_oy = attachment[6]
	self.presentation_xx = presentation[1]
	self.presentation_xy = presentation[2]
	self.presentation_yx = presentation[3]
	self.presentation_yy = presentation[4]
	self.presentation_ox = presentation[5]
	self.presentation_oy = presentation[6]
	self._local_xx = 0
	self._local_xy = 0
	self._local_yx = 0
	self._local_yy = 0
	self._local_ox = 0
	self._local_oy = 0
	self.wxx = 0
	self.wxy = 0
	self.wyx = 0
	self.wyy = 0
	self.wox = 0
	self.woy = 0
	self._pose_flags = all_dirty
	self._owner_basis_revision = -1
	self._owner_origin_revision = -1
	self._visual_basis_revision = 0
	self._translation_only = false
	return self, input
end

function visual_2d_component:set_attachment_affine(xx, xy, yx, yy, ox, oy)
	self.attachment_xx = xx
	self.attachment_xy = xy
	self.attachment_yx = yx
	self.attachment_yy = yy
	self.attachment_ox = ox
	self.attachment_oy = oy
	self._pose_flags = self._pose_flags | all_dirty
	return self
end

function visual_2d_component:set_attachment_basis(xx, xy, yx, yy)
	self.attachment_xx = xx
	self.attachment_xy = xy
	self.attachment_yx = yx
	self.attachment_yy = yy
	self._pose_flags = self._pose_flags | all_dirty
	return self
end

function visual_2d_component:set_attachment_origin(x, y)
	self.attachment_ox = x
	self.attachment_oy = y
	self._pose_flags = self._pose_flags | origin_dirty
	return self
end

function visual_2d_component:set_presentation_affine(xx, xy, yx, yy, ox, oy)
	self.presentation_xx = xx
	self.presentation_xy = xy
	self.presentation_yx = yx
	self.presentation_yy = yy
	self.presentation_ox = ox
	self.presentation_oy = oy
	self._pose_flags = self._pose_flags | all_dirty
	return self
end

function visual_2d_component:set_presentation_basis(xx, xy, yx, yy)
	self.presentation_xx = xx
	self.presentation_xy = xy
	self.presentation_yx = yx
	self.presentation_yy = yy
	self._pose_flags = self._pose_flags | basis_dirty
	return self
end

function visual_2d_component:set_presentation_origin(x, y)
	self.presentation_ox = x
	self.presentation_oy = y
	self._pose_flags = self._pose_flags | origin_dirty
	return self
end

-- One call per geometry batch. Own edits rebuild the retained local product;
-- owner revisions then select basis/origin work independently. A clean read
-- performs no composition, and ordinary translation never rebuilds a basis.
function visual_2d_component:resolve_pose()
	local spatial<const> = self.spatial
	hierarchy.resolve(spatial)
	local flags<const> = self._pose_flags
	local owner_basis<const> = spatial._basis_revision
	local owner_origin<const> = spatial._origin_revision
	local owner_basis_changed<const> = owner_basis ~= self._owner_basis_revision
	local basis_changed<const> = owner_basis_changed or (flags & basis_dirty) ~= 0
	local origin_changed<const> = owner_basis_changed or owner_origin ~= self._owner_origin_revision
		or (flags & origin_dirty) ~= 0
	if not basis_changed and not origin_changed then return self end
	if flags ~= 0 then
		local axx<const>, axy<const> = self.attachment_xx, self.attachment_xy
		local ayx<const>, ayy<const> = self.attachment_yx, self.attachment_yy
		if (flags & basis_dirty) ~= 0 then
			local pxx<const>, pxy<const> = self.presentation_xx, self.presentation_xy
			local pyx<const>, pyy<const> = self.presentation_yx, self.presentation_yy
			self._local_xx = axx * pxx + ayx * pxy
			self._local_xy = axy * pxx + ayy * pxy
			self._local_yx = axx * pyx + ayx * pyy
			self._local_yy = axy * pyx + ayy * pyy
		end
		if (flags & origin_dirty) ~= 0 then
			local px<const>, py<const> = self.presentation_ox, self.presentation_oy
			self._local_ox = axx * px + ayx * py + self.attachment_ox
			self._local_oy = axy * px + ayy * py + self.attachment_oy
		end
	end
	local xx<const>, xy<const> = spatial.wxx, spatial.wxy
	local yx<const>, yy<const> = spatial.wyx, spatial.wyy
	if basis_changed then
		local lxx<const>, lxy<const> = self._local_xx, self._local_xy
		local lyx<const>, lyy<const> = self._local_yx, self._local_yy
		local wxx<const> = xx * lxx + yx * lxy
		local wxy<const> = xy * lxx + yy * lxy
		local wyx<const> = xx * lyx + yx * lyy
		local wyy<const> = xy * lyx + yy * lyy
		self.wxx = wxx
		self.wxy = wxy
		self.wyx = wyx
		self.wyy = wyy
		self._translation_only = wxx == 1 and wxy == 0 and wyx == 0 and wyy == 1
		self._visual_basis_revision = self._visual_basis_revision + 1
	end
	if origin_changed then
		local ox<const>, oy<const> = self._local_ox, self._local_oy
		self.wox = xx * ox + yx * oy + spatial.wox
		self.woy = xy * ox + yy * oy + spatial.woy
	end
	self._owner_basis_revision = owner_basis
	self._owner_origin_revision = owner_origin
	self._pose_flags = 0
	return self
end

local origin_fields<const> = { 'ox', 'oy' }
local basis_fields<const> = { 'xx', 'xy', 'yx', 'yy' }
local affine_fields<const> = { 'xx', 'xy', 'yx', 'yy', 'ox', 'oy' }
visual_2d_component.timeline_channels = {
	protected = {
		order = true, presentation_order = true,
		attachment_xx = true, attachment_xy = true, attachment_yx = true, attachment_yy = true,
		attachment_ox = true, attachment_oy = true,
		presentation_xx = true, presentation_xy = true, presentation_yx = true, presentation_yy = true,
		presentation_ox = true, presentation_oy = true,
		_local_xx = true, _local_xy = true, _local_yx = true, _local_yy = true,
		_local_ox = true, _local_oy = true,
		wxx = true, wxy = true, wyx = true, wyy = true, wox = true, woy = true,
		_pose_flags = true, spatial = true,
		_owner_basis_revision = true, _owner_origin_revision = true,
		_visual_basis_revision = true,
		_translation_only = true,
	},
	properties = visual_component.timeline_channels.properties,
	groups = {
		attachment_affine2 = { fields = affine_fields,
			members = { 'attachment_xx', 'attachment_xy', 'attachment_yx', 'attachment_yy', 'attachment_ox', 'attachment_oy' },
			write = visual_2d_component.set_attachment_affine, phase = 'presentation' },
		attachment_basis2 = { fields = basis_fields,
			members = { 'attachment_xx', 'attachment_xy', 'attachment_yx', 'attachment_yy' },
			write = visual_2d_component.set_attachment_basis, phase = 'presentation' },
		attachment_origin2 = { fields = origin_fields,
			members = { 'attachment_ox', 'attachment_oy' },
			write = visual_2d_component.set_attachment_origin, phase = 'presentation' },
		presentation_affine2 = { fields = affine_fields,
			members = { 'presentation_xx', 'presentation_xy', 'presentation_yx', 'presentation_yy', 'presentation_ox', 'presentation_oy' },
			write = visual_2d_component.set_presentation_affine, phase = 'presentation' },
		presentation_basis2 = { fields = basis_fields,
			members = { 'presentation_xx', 'presentation_xy', 'presentation_yx', 'presentation_yy' },
			write = visual_2d_component.set_presentation_basis, phase = 'presentation' },
		presentation_origin2 = { fields = origin_fields,
			members = { 'presentation_ox', 'presentation_oy' },
			write = visual_2d_component.set_presentation_origin, phase = 'presentation' },
	},
}

return visual_2d_component
