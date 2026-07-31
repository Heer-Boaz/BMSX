local romdir<const> = require('cartlib/romdir')

local select_sprite_shape_ref<const> = function(collider, sprite)
	local image_id<const> = sprite.imgid
	local flip_h<const> = sprite.flip_h
	local flip_v<const> = sprite.flip_v
	if collider._sprite_shape_image_id == image_id then
		if collider._sprite_shape_flip_h == flip_h and collider._sprite_shape_flip_v == flip_v then
			return collider._sprite_shape_ref
		end
	else
		local image<const> = romdir.image(image_id)
		local bin_base<const> = image.collision_addr
		collider._sprite_shape_image_id = image_id
		collider._sprite_shape_ref_original = bin_base + mem[bin_base + 8]
		collider._sprite_shape_ref_fliph = bin_base + mem[bin_base + 12]
		collider._sprite_shape_ref_flipv = bin_base + mem[bin_base + 16]
		collider._sprite_shape_ref_fliphv = bin_base + mem[bin_base + 20]
	end

	local shape_ref
	if flip_h then
		if flip_v then
			shape_ref = collider._sprite_shape_ref_fliphv
		else
			shape_ref = collider._sprite_shape_ref_fliph
		end
	elseif flip_v then
		shape_ref = collider._sprite_shape_ref_flipv
	else
		shape_ref = collider._sprite_shape_ref_original
	end
	collider._sprite_shape_flip_h = flip_h
	collider._sprite_shape_flip_v = flip_v
	collider._sprite_shape_ref = shape_ref
	return shape_ref
end

return select_sprite_shape_ref
