-- Immutable image geometry bindings are shared by their actual ROM address.
-- A collider admits the complete image set before normal animation samples.
local rom_dir<const> = require('cartlib/rom_dir')
local collision_shape<const> = require('cartlib/collision/collision_shape')
local sprite_shape<const> = {}

function sprite_shape.image(image_id)
	if image_id == nil then
		error('sprite-derived collider requires an admitted image geometry source')
	end
	return collision_shape.bind(rom_dir.image(image_id).collision_addr)
end

function sprite_shape.select(collider, sprite)
	local image_id<const> = sprite.imgid
	local flip_h<const>, flip_v<const> = sprite.flip_h, sprite.flip_v
	if collider._sprite_image_id == image_id
	and collider._sprite_flip_h == flip_h and collider._sprite_flip_v == flip_v then
		return collider._sprite_shape_ref
	end
	local binding<const> = collider._sprite_images[image_id]
	local shape_ref
	if flip_h then
		shape_ref = flip_v and binding.fliphv or binding.fliph
	else
		shape_ref = flip_v and binding.flipv or binding.original
	end
	collider._sprite_image_id = image_id
	collider._sprite_flip_h = flip_h
	collider._sprite_flip_v = flip_v
	collider._sprite_shape_ref = shape_ref
	return shape_ref
end

function sprite_shape.admit(sprite)
	local images<const> = {}
	local maximum = 0
	if sprite.animations ~= nil then
		for _, animation in pairs(sprite.animations) do
			for index = 1, animation.frame_count do
				local id<const> = animation.frames[index]
				local binding<const> = sprite_shape.image(id)
				images[id] = binding
				if binding.bytes > maximum then maximum = binding.bytes end
			end
		end
	elseif sprite.frames ~= nil then
		for index = 1, sprite.frame_count do
			local id<const> = sprite.frames[index]
			local binding<const> = sprite_shape.image(id)
			images[id] = binding
			if binding.bytes > maximum then maximum = binding.bytes end
		end
	else
		local binding<const> = sprite_shape.image(sprite.imgid)
		images[sprite.imgid] = binding
		maximum = binding.bytes
	end
	return images, maximum
end

return sprite_shape
