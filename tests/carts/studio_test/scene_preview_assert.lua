local world<const> = require('cartlib/world/world')
local scenes<const> = require('cartlib/world/scene_library')

return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('ordinary cart initialization', function() return studio_test_ready end, 120)
		t:at_boundary(world:request_mutation_boundary(), 120)
		world:clear()
		-- The caller supplies construction inputs; the Scene member owns placement.
		-- Preview consumes this exact instance, not its registry ID or a copied plan.
		t.scene = scenes.instantiate('studio_test.initialized_text', { caption = { content = 'studio' } })
	end,
	teardown = function(t)
		t.scene:dispose()
		studio_test_preview_cleaned = true
	end,
	tests = {
		initialized = function(t)
			studio_test_preview_case_ran = true
			assert(t.scene.members.caption.content == 'studio')
			assert(t.scene.members.caption.caption ~= nil)
		end,
	},
}
