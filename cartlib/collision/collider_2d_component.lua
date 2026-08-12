local select_sprite_shape_ref<const> = require('cartlib/collision/sprite_shape')
local base_component<const> = require('cartlib/component/base_component')

local collider_2d_component<const> = {}
collider_2d_component.__index = collider_2d_component
setmetatable(collider_2d_component, { __index = base_component })

local invalidate_overlap_shape<const> = function(collider)
	collider._overlap_cache_valid = false
end

function collider_2d_component:prepare_overlap()
	if self._overlap_cache_valid then
		return
	end
	local collider<const> = self
	local parent<const> = collider.parent
	local sprite<const> = collider.sprite
	local shape_offset_x = collider.shape_offset_x
	local shape_offset_y = collider.shape_offset_y
	local local_area<const> = collider.local_area
	local geo_shape_ref
	if sprite then
		geo_shape_ref = select_sprite_shape_ref(collider, sprite)
		shape_offset_x = sprite.offset_x
		shape_offset_y = sprite.offset_y
	end
	collider._overlap_geo_tx = parent.x + shape_offset_x
	collider._overlap_geo_ty = parent.y + shape_offset_y
	if not sprite then
		if local_area then
			collider._overlap_local_left = local_area.left
			collider._overlap_local_top = local_area.top
			collider._overlap_local_right = local_area.right
			collider._overlap_local_bottom = local_area.bottom
		else
			collider._overlap_local_left = 0
			collider._overlap_local_top = 0
			collider._overlap_local_right = parent.sx
			collider._overlap_local_bottom = parent.sy
		end
	end
	collider._overlap_geo_shape_ref = geo_shape_ref
	collider._overlap_cache_valid = true
end

function collider_2d_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), collider_2d_component)
	self.layer = opts.layer or 1
	self.mask = opts.mask or 0xffffffff
	self.local_area = opts.local_area
	self.shape_offset_x = opts.shape_offset_x or 0
	self.shape_offset_y = opts.shape_offset_y or 0
	self._overlap_cache_valid = false
	self._overlap_local_left = 0
	self._overlap_local_top = 0
	self._overlap_local_right = 0
	self._overlap_local_bottom = 0
	self._overlap_geo_tx = 0
	self._overlap_geo_ty = 0
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
		local previous_collider<const> = sprite._collider
		if previous_collider then
			previous_collider.sprite = nil
			previous_collider._sprite_shapeimage_id = nil
			invalidate_overlap_shape(previous_collider)
		end
		sprite._collider = self
	end
	self.sprite = sprite
	self._sprite_shapeimage_id = nil
	invalidate_overlap_shape(self)
end

function collider_2d_component:on_detach()
	self:set_sprite(nil)
	if self.parent.collider == self then
		self.parent.collider = nil
	end
end

function collider_2d_component:set_local_area(area)
	self.local_area = area
	invalidate_overlap_shape(self)
end

function collider_2d_component:set_shape_offset(offset_x, offset_y)
	self.shape_offset_x = offset_x
	self.shape_offset_y = offset_y
	invalidate_overlap_shape(self)
end

return collider_2d_component
