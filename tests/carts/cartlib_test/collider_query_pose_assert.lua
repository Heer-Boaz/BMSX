local collider<const> = require('cartlib/collision/collider_2d_component')
local collision<const> = require('cartlib/collision/collision_2d')
local geometry_pool<const> = require('cartlib/collision/geometry_pool')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')

bss geometry: word[32]
local pool<const> = geometry_pool.new(geometry, 64, 2)
prefab.define({ def_id = 'cartlib_test.query_body', class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1, 0, 1, 1, 10, 10 } },
	initial = { collider = { geometry_pool = pool, local_affine = { 1, 0, 0, 1, 2, 1 },
		local_area = { left = 0, top = 0, right = 4, bottom = 4 } } },
	components = { collider.new },
})
prefab.define({ def_id = 'cartlib_test.query_target', class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1, 0, 0, 1, 57.25, 33.25 } },
	initial = { collider = { geometry_pool = pool,
		local_area = { left = 0, top = 0, right = 0.5, bottom = 0.5 } } },
	components = { collider.new },
})

return { kind = 'unit', tests = {
	candidate_displacement_preserves_exact_shape_and_live_pose = function()
		local owner<const> = getmetatable(world).new()
		owner:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1,
			frame_interval_vblanks = 1, spaces = { 'test' }, systems = {} })
		local actor<const> = owner:spawn('cartlib_test.query_body', {})
		local target<const> = owner:spawn('cartlib_test.query_target', {})
		local body<const> = actor:get_component(collider)
		local probe<const> = target:get_component(collider)
		local pose<const> = actor.spatial:resolve_world()
		local shape<const> = body:resolve_shape()
		local basis_revision<const>, origin_revision<const> = pose._basis_revision, pose._origin_revision
		local geometry_revision<const> = body._geometry_basis_revision
		assert(collision.collides(body, probe) == nil, 'current pose unexpectedly intersects the candidate target')
		local candidate<const> = collision.collides(body, probe, 40, 20)
		assert(candidate ~= nil, 'world displacement lost the actual collider attachment or shear')
		local normal_x<const>, normal_y<const> = candidate.normal.x, candidate.normal.y
		local depth<const>, point_x<const>, point_y<const> = candidate.depth, candidate.point.x, candidate.point.y
		for _ = 1, 64 do
			assert(collision.collides(body, probe, 40, 20) == candidate,
				'candidate query replaced its retained contact record')
		end
		assert(pose.ox == 10 and pose.oy == 10 and pose.wox == 10 and pose.woy == 10
			and pose._basis_revision == basis_revision and pose._origin_revision == origin_revision
			and body._geometry_basis_revision == geometry_revision and body:resolve_shape() == shape
			and body.wox == 13 and body.woy == 11,
			'candidate query published or restored actor/collider authority or invalidated geometry')
		assert(collision.collides(body, probe) == nil, 'a candidate displacement leaked into the next query')
		target.spatial:set_world_origin(53.25, 34.25)
		assert(collision.collides(body, probe, 40, 20) == nil,
			'candidate query replaced the exact sheared polygon with its broadphase box')
		target.spatial:set_world_origin(57.25, 33.25)
		actor.spatial:set_world_origin(50, 30)
		local committed<const> = collision.collides(body, probe)
		assert(committed ~= nil and committed.normal.x == normal_x and committed.normal.y == normal_y
			and committed.depth == depth and committed.point.x == point_x and committed.point.y == point_y,
			'candidate contact differs from the same actual committed world displacement')
		owner:clear()
	end,
} }
