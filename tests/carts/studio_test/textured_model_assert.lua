local world<const> = require('cartlib/world/world')
local scenes<const> = require('cartlib/world/scene_library')
local renderer<const> = require('cartlib/component/model_renderer_component')
local model<const> = require('cartlib/component/static_model_component')

return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('ordinary cart initialization', function() return studio_test_ready end, 120)
		t:at_boundary(world:request_mutation_boundary(), 120)
		world:clear()
		t.scene = scenes.instantiate('studio_test.textured')
	end,
	teardown = function(t)
		t:at_boundary(world:request_mutation_boundary(), 120)
		t.scene:dispose()
	end,
	tests = {
		textured_pass = function(t)
			local camera<const> = t.scene.members.camera:get_component(renderer)
			local visual<const> = t.scene.members.panels:get_component(model)
			local source<const> = visual._source
			local image<const> = source.parts[1].primitives[1].texture
			assert(image == source.parts[2].primitives[1].texture)
			t:wait_ticks(4)
			assert(image._texture._allocation ~= nil and camera._batch.has_textures and camera._batch.count == 6)
			t:capture('textured-model-flat-affine')
			local uv<const> = camera._batch.uv0
			t:at_boundary(world:request_mutation_boundary(), 120)
			visual:set_presentation_origin(0, 0, 2.5)
			t:wait_ticks(4)
			assert(camera._batch.count > 0 and camera._batch.uv0 == uv and visual._source == source)
			t:capture('textured-model-near-clipped')
		end,
	},
}
