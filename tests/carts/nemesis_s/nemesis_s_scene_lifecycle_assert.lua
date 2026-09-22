local shallow_copy<const> = require('cartlib/util/shallow_copy')
local registry<const> = require('cartlib/registry')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')
local assert_disposed<const> = function(members)
	for _, object in pairs(members) do
		assert(object.world == nil and registry:get(object.id) == nil and #object._components == 0,
		'scene exit retained a member or its components')
	end
end
return {kind = 'integration', tests = { title_takeoff_and_reentry = function(t)
			t:wait_until('title director', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			local director<const> = registry:get('nemesis_s.director')
			director.state_machines:transition_to('/title')
			local title<const> = registry:get('nemesis_s.title_screen')
			local first<const> = shallow_copy(title.presentation.members)
			local second<const> = scene_library.instantiate('nemesis_s.title')
			assert(first.selector ~= second.members.selector and first.selector.id ~= second.members.selector.id,
			'title placements shared an object or a runtime identity')
			second.members.selector.sprite_component.offset_y = 16
			assert(first.selector.sprite_component.offset_y == 0,
			'a second scene mutated the first scene visual')
			local second_members<const> = shallow_copy(second.members)
			second:dispose()
			assert_disposed(second_members)
			assert(next(second.members) == nil, 'disposed scene retained named members')
			assert(registry:get(first.selector.id) == first.selector,
			'disposing another scene removed the live selector')
			local menu<const> = first
			t:press('Space', 2)
			t:wait_until('hangar composition', function() return title.presentation ~= nil and title.presentation.members.ship ~= nil end, 120)
			assert_disposed(menu)
			local hangar<const> = shallow_copy(title.presentation.members)
			assert(hangar.ship.space_id == 'title' and hangar.ship.start_y == 129, 'takeoff discarded authored hangar placement')
			t:wait_until('takeoff completes', function() return world.active_space_id == 'main' end, 650)
			assert_disposed(hangar)
			assert(title.presentation == nil, 'gameplay retained the hangar composition')
			director.state_machines:transition_to('/title')
			local reentered<const> = shallow_copy(title.presentation.members)
			assert(reentered.selector ~= menu.selector and title.selected_player_count == 1, 'title reentry reused stale selection or objects')
			new_game()
			assert_disposed(reentered)
			assert(title.world == nil and title.presentation == nil, 'New Game retained the old controller scene')
			assert(world.active_space_id == 'intro' and registry:get('nemesis_s.title_screen') ~= title, 'New Game did not restore the root composition')

		end, }, }
