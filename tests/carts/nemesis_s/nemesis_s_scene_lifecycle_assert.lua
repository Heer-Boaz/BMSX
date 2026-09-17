local shallow_copy<const> = require('cartlib/util/shallow_copy')
local registry<const> = require('cartlib/registry')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')

__bmsx_host_test = { phase = 'confirm', ticks = 0 }

local assert_disposed<const> = function(members)
	for _, object in pairs(members) do
		assert(object.world == nil and registry:get(object.id) == nil and #object._components == 0,
			'scene exit retained a member or its components')
	end
end

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
end

function __bmsx_host_test.setup()
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
	__bmsx_host_test.menu = first
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.ticks = test.ticks + 1
	assert(test.ticks < 650, 'scene lifecycle did not finish its real input/timeline flow')
	local title<const> = registry:get('nemesis_s.title_screen')
	if test.phase == 'confirm' then
		test.phase = 'flight'
		return host.press('Space', 2)
	end
	if test.phase == 'flight' then
		if title.presentation == nil or title.presentation.members.ship == nil then
			return false
		end
		assert_disposed(test.menu)
		test.hangar = shallow_copy(title.presentation.members)
		assert(test.hangar.ship.space_id == 'title'
			and test.hangar.ship.start_y == 129,
			'takeoff did not consume the authored hangar in the active space')
		test.phase = 'gameplay'
		return false
	end
	if test.phase == 'gameplay' then
		if world.active_space_id ~= 'main' then
			return false
		end
		assert_disposed(test.hangar)
		assert(title.presentation == nil, 'gameplay retained the hangar composition')
		-- Exercise parent teardown with an active scene, as happens on cart reset.
		registry:get('nemesis_s.director').state_machines:transition_to('/title')
		test.reentered = shallow_copy(title.presentation.members)
		assert(test.reentered.selector ~= test.menu.selector and title.selected_player_count == 1,
			'title reentry reused stale selection or runtime objects')
		test.old_title = title
		new_game()
		assert_disposed(test.reentered)
		assert(title.world == nil and title.presentation == nil,
			'cart reboot did not release the controller-owned scene')
		test.phase = 'rebooted'
		return false
	end
	assert(world.active_space_id == 'intro' and title ~= test.old_title,
		'cart reboot did not restore the root composition')
	return true
end
