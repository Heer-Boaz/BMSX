local rom_dir<const> = require('cartlib/rom_dir')
local collision_shape<const> = require('cartlib/collision/collision_shape')

local select_sprite_shape_ref<const> = function(collider, sprite)
	local image_id<const> = sprite.imgid
	local flip_h<const> = sprite.flip_h
	local flip_v<const> = sprite.flip_v
	if collider._sprite_shapeimage_id == image_id then
		if collider._sprite_shapeflip_h == flip_h and collider._sprite_shapeflip_v == flip_v then
			return collider._sprite_shaperef
		end
	else
		local image<const> = rom_dir.image(image_id)
		local bin_base<const> = image.collision_addr
		collider._sprite_shapeimage_id = image_id
		collider._sprite_shaperef_original,
			collider._sprite_shaperef_fliph,
			collider._sprite_shaperef_flipv,
			collider._sprite_shaperef_fliphv = collision_shape.variant_addresses(bin_base)
	end

	local shape_ref
	if flip_h then
		if flip_v then
			shape_ref = collider._sprite_shaperef_fliphv
		else
			shape_ref = collider._sprite_shaperef_fliph
		end
	elseif flip_v then
		shape_ref = collider._sprite_shaperef_flipv
	else
		shape_ref = collider._sprite_shaperef_original
	end
	collider._sprite_shapeflip_h = flip_h
	collider._sprite_shapeflip_v = flip_v
	collider._sprite_shaperef = shape_ref
	return shape_ref
end

return select_sprite_shape_ref
