local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local confirm_hold_frames<const> = 4

return {
	kind = 'integration',
	tests = {
		scanout = function(t)
			t:wait_until('presentation controllers', function() return registry:get('d') ~= nil
				and registry:get('intro') ~= nil
				and registry:get('narrative') ~= nil
				and registry:get('title_screen') ~= nil end, 120)
			local test<const> = {}
			local director<const> = registry:get('d')
			local narrative<const> = registry:get('narrative')
			local title_screen<const> = registry:get('title_screen')
			test.intro_state = director.state_machines:bind_state_path('/intro')
			test.story_state = director.state_machines:bind_state_path('/story')
			test.title_state = director.state_machines:bind_state_path('/title_screen')
			test.narrative_story_state = narrative.state_machines:bind_state_path('/story/active')
			test.title_idle_state = title_screen.state_machines:bind_state_path('/idle')
			test.narrative = narrative
			test.title_screen = title_screen
			assert(director.state_machines:matches_state(test.intro_state), 'Pietious did not boot into the intro')
			assert(world.active_space_id == 'intro', 'intro did not own the presentation space')
			t:press('AltRight', confirm_hold_frames)
			t:wait_until('intro skip reaches story', function() return director.state_machines:matches_state(test.story_state) end, 120)
			assert(world.active_space_id == 'narrative', 'story did not own narrative space')
			t:wait_until('story input ready', function() return narrative.state_machines:matches_state(test.narrative_story_state) end, 120)
			t:press('AltRight', confirm_hold_frames)
			t:wait_until('story skip reaches title', function() return director.state_machines:matches_state(test.title_state) end, 120)
			assert(world.active_space_id == 'title', 'title did not own presentation space')
			t:wait_until('title input ready', function() return title_screen.state_machines:matches_state(test.title_idle_state) end, 120)
			t:press('AltRight', confirm_hold_frames)
			t:wait_until('title admits new game', function()
				return registry:get('d') ~= director and world.active_space_id == 'main' and registry:get('c').current_room_number == 1
			end, 240)
			t:capture('gameplay-after-start-input')

		end,
	},
}
