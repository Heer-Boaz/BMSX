local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

return {
	kind = 'integration',
	tests = {
		intro_confirm_is_not_a_story_confirm = function(t)
			t:wait_until('intro visible', function()
				local intro<const> = registry:get('nemesis_s.intro')
				return intro ~= nil and intro.presentation ~= nil
			end, 120)
			t:at_boundary(world:request_mutation_boundary(), 30)
			local story<const> = registry:get('nemesis_s.story')
			local title<const> = registry:get('nemesis_s.title_screen')
			t:down('Space')
			t:wait_until('first confirm enters story', function()
				return world.active_space_id == 'story'
			end, 30)
			t:wait_ticks(8)
			assert(world.active_space_id == 'story' and story.presentation ~= nil and title.presentation == nil,
				'the intro press also skipped the story on the gameplay clock')
			t:up('Space')
			t:wait_ticks(4)
			t:press('Space', 4)
			t:wait_until('new confirm enters title', function()
				return world.active_space_id == 'title' and title.presentation ~= nil
			end, 30)
		end,
	},
}
