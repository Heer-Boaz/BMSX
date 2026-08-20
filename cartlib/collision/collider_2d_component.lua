local base_component<const> = require('cartlib/component/base_component')
local sprite_component<const> = require('cartlib/component/sprite_component')
local collision_shape<const> = require('cartlib/collision/collision_shape')

local collider_2d_component<const> = {}
collider_2d_component.__index = collider_2d_component
setmetatable(collider_2d_component, { __index = base_component })

function collider_2d_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), collider_2d_component)
	self.layer = opts.layer or 1
	self.mask = opts.mask or 0xffffffff
	self.local_area = opts.local_area
	self.shape_offset_x = opts.shape_offset_x or 0
	self.shape_offset_y = opts.shape_offset_y or 0
	return self
end

-- Sprite-derived collision is explicit prefab composition. The collider keeps
-- the resolved sprite component directly, and GEO selects the current packed
-- @cx/@cc shape lazily when the pair is staged. Sprite objects without this
-- constructor own no collider and never enter the overlap pass.
--
--   @cx  - one convex hull
--   @cc  - a multi-piece convex fit
--   none - the image bounds
function collider_2d_component.new_for_sprite(opts)
	local self<const> = collider_2d_component.new(opts)
	self:set_sprite(opts.parent:get_component(sprite_component))
	return self
end

function collider_2d_component:set_sprite(sprite)
	local previous_sprite<const> = self.sprite
	if previous_sprite == sprite then
		return
	end
	if previous_sprite then
		previous_sprite._collider = nil
	end
	if sprite then
		self.shape_ref = nil
		self._shape_ref_original = nil
		self._shape_ref_fliph = nil
		self._shape_ref_flipv = nil
		self._shape_ref_fliphv = nil
		local previous_collider<const> = sprite._collider
		if previous_collider then
			previous_collider.sprite = nil
			previous_collider._sprite_shapeimage_id = nil
		end
		sprite._collider = self
	end
	self.sprite = sprite
	self._sprite_shapeimage_id = nil
end

-- Binds one packed collision_shape asset. The four variant addresses are
-- retained on the component so the GEO submission path never decodes an asset
-- header or scans the authored tile map.
function collider_2d_component:set_shape_asset(asset_address)
	self:set_sprite(nil)
	self._shape_ref_original,
		self._shape_ref_fliph,
		self._shape_ref_flipv,
		self._shape_ref_fliphv = collision_shape.variant_addresses(asset_address)
	self.shape_ref = self._shape_ref_original
end

function collider_2d_component:set_shape_flip(flip_h, flip_v)
	if flip_h then
		if flip_v then
			self.shape_ref = self._shape_ref_fliphv
		else
			self.shape_ref = self._shape_ref_fliph
		end
	elseif flip_v then
		self.shape_ref = self._shape_ref_flipv
	else
		self.shape_ref = self._shape_ref_original
	end
end

function collider_2d_component:on_detach()
	self:set_sprite(nil)
	if self.parent.collider == self then
		self.parent.collider = nil
	end
end

return collider_2d_component
