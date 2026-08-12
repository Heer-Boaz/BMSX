local rom_dir<const> = require('cartlib/rom_dir')

struct geo_collision_variant_header
	magic: word
	version: word
	original_offset: word
	fliph_offset: word
	flipv_offset: word
	fliphv_offset: word
	reserved0: word
	reserved1: word
end

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
		local variants<const>: *geo_collision_variant_header = bin_base
		collider._sprite_shapeimage_id = image_id
		collider._sprite_shaperef_original = bin_base + variants->original_offset
		collider._sprite_shaperef_fliph = bin_base + variants->fliph_offset
		collider._sprite_shaperef_flipv = bin_base + variants->flipv_offset
		collider._sprite_shaperef_fliphv = bin_base + variants->fliphv_offset
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
