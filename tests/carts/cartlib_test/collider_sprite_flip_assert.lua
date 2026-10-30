local collider<const> = require('cartlib/collision/collider_2d_component')
local collision<const> = require('cartlib/collision/collision_2d')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local sprite<const> = require('cartlib/component/sprite_component')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')

bss geometry: word[32]
local pool<const> = geometry_pool.new(geometry, 64, 2)
prefab.define({ def_id = 'cartlib_test.flipped_sprite', class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1,0,0,1,10,20 } },
	initial = { collider = { geometry_pool = pool, sprite_id_local = 'sprite' } },
	components = { sprite.factory({ imgid = 'collision_asymmetric' }), collider.new_for_sprite },
})
prefab.define({ def_id = 'cartlib_test.flip_probe', class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1,0,0,1,12.25,20.25 } },
	initial = { collider = { geometry_pool = pool, local_area = { left=0,top=0,right=0.5,bottom=0.5 } } },
	components = { collider.new },
})

return {
	kind = 'unit',
	tests = {
		image_reflection_and_world_affine_share_their_real_geometry = function()
			local owner<const> = getmetatable(world).new()
			owner:configure({ framebuffer_count=1,gameplay_interval_vblanks=1,frame_interval_vblanks=1,
				spaces={'test'},systems={} })
			local actor<const> = owner:spawn('cartlib_test.flipped_sprite', {})
			local probe<const> = owner:spawn('cartlib_test.flip_probe', {})
			local body<const>, target<const> = actor:get_component(collider), probe:get_component(collider)
			local visual<const> = actor:get_component(sprite)
			assert(collision.collides(body,target) == nil, 'original pixels unexpectedly cover the reflected side')
			visual.flip_h = true
			assert(collision.collides(body,target) ~= nil,
				'packed AABB reflection differs from the image pixel-center reflection')
			visual.flip_h, visual.flip_v = false, true
			probe.spatial:set_world_origin(10.25,21.25)
			assert(collision.collides(body,target) ~= nil, 'vertical image reflection shifted physical geometry')
			visual.flip_h = true
			probe.spatial:set_world_origin(12.25,21.25)
			assert(collision.collides(body,target) ~= nil, 'combined image reflection shifted physical geometry')
			visual.flip_v = false
			actor.spatial:set_local_affine(-1,0,0,1,25,20)
			probe.spatial:set_world_origin(22.25,20.25)
			assert(collision.collides(body,target) ~= nil,
				'world reflection did not transform the selected prebuilt image geometry')
			owner:clear()
		end,
	},
}
