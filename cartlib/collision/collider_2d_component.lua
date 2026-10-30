local affine2<const> = require('cartlib/math/affine2')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')
local base_component<const> = require('cartlib/component/base_component')
local sprite_component<const> = require('cartlib/component/sprite_component')
local collision_shape<const> = require('cartlib/collision/collision_shape')
local sprite_shape<const> = require('cartlib/collision/sprite_shape')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local shape_geometry<const> = require('cartlib/collision/shape_geometry')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local collider_2d_component<const> = {}
collider_2d_component.__index = collider_2d_component
setmetatable(collider_2d_component, { __index = base_component })
local empty_input<const> = {}
local identity<const> = { 1, 0, 0, 1, 0, 0 }

function collider_2d_component:reserve_geometry(required)
	local pool<const> = self.geometry_pool
	if required > pool.slot_bytes then error('collider source exceeds the admitted geometry slot') end
	if self._geometry_address == nil then
		self._geometry_address = geometry_pool.acquire(pool)
	end
	self._geometry_basis_revision = -1
end

function collider_2d_component:resolve_pose()
	local spatial<const> = self.spatial
	hierarchy.resolve(spatial)
	local flags<const> = self._local_flags
	local owner_basis<const>, owner_origin<const> = spatial._basis_revision, spatial._origin_revision
	local changed_basis<const> = owner_basis ~= self._owner_basis_revision
	local basis_changed<const> = changed_basis or (flags & 1) ~= 0
	local origin_changed<const> = changed_basis or owner_origin ~= self._owner_origin_revision or (flags & 2) ~= 0
	if basis_changed or origin_changed then
		affine2.evaluate(self, spatial, basis_changed, origin_changed)
		if basis_changed then
			self._basis_revision = self._basis_revision + 1
			self._translation_only = self.wxx == 1 and self.wxy == 0 and self.wyx == 0 and self.wyy == 1
		end
		self._owner_basis_revision = owner_basis
		self._owner_origin_revision = owner_origin
		self._local_flags = 0
	end
	return self
end

local resolve_asset<const> = function(self)
	local source<const> = self.shape_ref
	if self._translation_only then return source end
	if self._geometry_source ~= source or self._geometry_basis_revision ~= self._basis_revision then
		shape_geometry.write(source, self._geometry_address, self.wxx, self.wxy, self.wyx, self.wyy)
		self._geometry_source = source
		self._geometry_basis_revision = self._basis_revision
	end
	return self._geometry_address
end

local resolve_sprite<const> = function(self)
	local source<const> = sprite_shape.select(self, self.sprite)
	if self._translation_only then return source end
	if self._geometry_source ~= source or self._geometry_basis_revision ~= self._basis_revision then
		shape_geometry.write(source, self._geometry_address, self.wxx, self.wxy, self.wyx, self.wyy)
		self._geometry_source = source
		self._geometry_basis_revision = self._basis_revision
	end
	return self._geometry_address
end

local resolve_area<const> = function(self)
	if self._geometry_revision ~= self._consumed_geometry_revision
	or self._geometry_basis_revision ~= self._basis_revision then
		shape_geometry.write_area(self._geometry_address,
			self.local_left, self.local_top, self.local_right, self.local_bottom,
			self.wxx, self.wxy, self.wyx, self.wyy)
		self._geometry_basis_revision = self._basis_revision
		self._consumed_geometry_revision = self._geometry_revision
	end
	return self._geometry_address
end

function collider_2d_component:resolve_shape()
	self:resolve_pose()
	return self._resolve_geometry(self)
end

function collider_2d_component:set_local_affine(xx, xy, yx, yy, ox, oy)
	self.xx, self.xy, self.yx, self.yy = xx, xy, yx, yy
	self.ox, self.oy = ox, oy
	self._local_flags = self._local_flags | 3
	return self
end

function collider_2d_component:set_local_origin(x, y)
	self.ox, self.oy = x, y
	self._local_flags = self._local_flags | 2
	return self
end

function collider_2d_component:set_local_area(left, top, right, bottom)
	self.local_left, self.local_top = left, top
	self.local_right, self.local_bottom = right, bottom
	self._geometry_revision = self._geometry_revision + 1
	return self
end

function collider_2d_component:set_enabled(enabled)
	if enabled and not self.enabled then self._activation_revision = self._activation_revision + 1 end
	return base_component.set_enabled(self, enabled)
end

-- Concrete area/asset/sprite/strip constructors share this physical identity
-- setup, then admit their own shape source before returning to World.
function collider_2d_component.construct(context, id_local, defaults)
	local definition<const> = defaults or empty_input
	local local_id<const> = id_local or definition.id_local or 'collider'
	local input<const> = context.initial[local_id] or empty_input
	local spatial<const> = context.owner.spatial
	if spatial == nil or spatial._family ~= affine2 then error('Collider2D requires its owner\'s Transform2D') end
	local self<const> = setmetatable(base_component.new(context), collider_2d_component)
	self.id_local = local_id
	self.spatial = spatial
	self.geometry_pool = input.geometry_pool or definition.geometry_pool
	self.layer = input.layer or definition.layer or 1
	self.mask = input.mask or definition.mask or 0xffffffff
	local enabled = input.enabled
	if enabled == nil then enabled = definition.enabled end
	self.enabled = enabled == nil or enabled
	self._activation_revision = 0
	local local_transform<const> = input.local_affine or definition.local_affine or identity
	self.xx, self.xy, self.yx, self.yy = local_transform[1], local_transform[2], local_transform[3], local_transform[4]
	self.ox, self.oy = local_transform[5], local_transform[6]
	self.wxx, self.wxy, self.wyx, self.wyy, self.wox, self.woy = 0, 0, 0, 0, 0, 0
	self._owner_basis_revision = -1
	self._owner_origin_revision = -1
	self._basis_revision = 0
	self._local_flags = 3
	self._geometry_revision = 0
	self._consumed_geometry_revision = -1
	self._geometry_basis_revision = -1
	self._translation_only = false
	return self, input, definition
end

function collider_2d_component.new(context, id_local, defaults)
	local self<const>, input<const>, definition<const> = collider_2d_component.construct(context, id_local, defaults)
	local asset<const> = input.shape_asset or definition.shape_asset
	if asset ~= nil then
		self:set_shape_asset(asset)
	else
		local area<const> = input.local_area or definition.local_area
		self:set_local_area(area.left, area.top, area.right, area.bottom)
		self:reserve_geometry(64)
		self._resolve_geometry = resolve_area
	end
	return self
end

function collider_2d_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	return function(context, id_local)
		return collider_2d_component.new(context, id_local, defaults)
	end
end

function collider_2d_component:admit_sprite_image(image_id)
	local binding<const> = sprite_shape.image(image_id)
	if binding.bytes > self.geometry_pool.slot_bytes then error('sprite image exceeds the admitted collider geometry slot') end
	self._sprite_images[image_id] = binding
	self._sprite_image_id = nil
	if binding.bytes > self._sprite_required_bytes then self._sprite_required_bytes = binding.bytes end
end

function collider_2d_component:set_sprite(sprite)
	if self.sprite == sprite then return self end
	local images
	local required
	if sprite ~= nil then
		if sprite._collider ~= nil and sprite._collider ~= self then error('sprite geometry already belongs to another collider binding') end
		images, required = sprite_shape.admit(sprite)
		self:reserve_geometry(required)
	end
	local previous<const> = self.sprite
	if previous ~= nil then previous._collider = nil end
	self.sprite = sprite
	self._sprite_image_id = nil
	self._sprite_images = images
	self._sprite_required_bytes = required
	if sprite == nil then return self end
	sprite._collider = self
	self._shape_asset = nil
	self._resolve_geometry = resolve_sprite
	return self
end

function collider_2d_component.new_for_sprite(context, id_local, defaults)
	local self<const>, input<const>, definition<const> = collider_2d_component.construct(context, id_local, defaults)
	local sprite_id<const> = input.sprite_id_local or definition.sprite_id_local or 'base_sprite'
	local sprite<const> = context.owner:get_component(sprite_component, sprite_id)
	if sprite == nil then error('sprite-derived collider requires its declared sprite component') end
	self:set_sprite(sprite)
	return self
end

function collider_2d_component.factory_for_sprite(definition)
	local defaults<const> = shallow_copy(definition)
	return function(context, id_local)
		return collider_2d_component.new_for_sprite(context, id_local, defaults)
	end
end

function collider_2d_component:set_shape_asset(asset_address)
	if self._shape_asset == asset_address then return self end
	local original<const>, fliph<const>, flipv<const>, fliphv<const> = collision_shape.variant_addresses(asset_address)
	local maximum = shape_geometry.measure(original)
	local bytes = shape_geometry.measure(fliph)
	if bytes > maximum then maximum = bytes end
	bytes = shape_geometry.measure(flipv)
	if bytes > maximum then maximum = bytes end
	bytes = shape_geometry.measure(fliphv)
	if bytes > maximum then maximum = bytes end
	self:reserve_geometry(maximum)
	self:set_sprite(nil)
	self._shape_asset = asset_address
	self._shape_ref_original, self._shape_ref_fliph = original, fliph
	self._shape_ref_flipv, self._shape_ref_fliphv = flipv, fliphv
	self.shape_ref = original
	self._resolve_geometry = resolve_asset
	return self
end

function collider_2d_component:set_shape_flip(flip_h, flip_v)
	if flip_h then self.shape_ref = flip_v and self._shape_ref_fliphv or self._shape_ref_fliph
	else self.shape_ref = flip_v and self._shape_ref_flipv or self._shape_ref_original end
	return self
end

-- Geometry is acquired by construction, before attachment notification. This
-- unconditional component teardown also covers a factory that closes its
-- Scene before returning the final component to World.
function collider_2d_component:unbind()
	self:set_sprite(nil)
	geometry_pool.release(self.geometry_pool, self._geometry_address)
	self._geometry_address = nil
	if self.owner.collider == self then self.owner.collider = nil end
	base_component.unbind(self)
end

return collider_2d_component
