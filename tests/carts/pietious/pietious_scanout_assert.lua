local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local confirm_hold_frames<const> = 4

__bmsx_host_test = {
	phase = 'skip_intro',
	settle_frames = 0,
}

function __bmsx_host_test.ready()
	return registry:get('d') ~= nil
		and registry:get('intro') ~= nil
		and registry:get('narrative') ~= nil
		and registry:get('title_screen') ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
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
end

function __bmsx_host_test.update(frame)
	local test<const> = __bmsx_host_test
	local director<const> = registry:get('d')

	if test.phase == 'skip_intro' then
		test.phase = 'await_story'
		test.confirm_release_frame = frame + confirm_hold_frames
		return host.press('AltRight', confirm_hold_frames)
	end

	if test.phase == 'await_story' then
		if director.state_machines:matches_state(test.intro_state) then
			return false
		end
		assert(director.state_machines:matches_state(test.story_state), 'intro did not advance to the story')
		assert(world.active_space_id == 'narrative', 'story did not own the narrative presentation space')
		if frame <= test.confirm_release_frame
		or not test.narrative.state_machines:matches_state(test.narrative_story_state) then
			return false
		end
		test.phase = 'await_title'
		test.confirm_release_frame = frame + confirm_hold_frames
		return host.press('AltRight', confirm_hold_frames)
	end

	if test.phase == 'await_title' then
		if director.state_machines:matches_state(test.story_state) then
			return false
		end
		assert(director.state_machines:matches_state(test.title_state), 'story did not advance to the title screen')
		assert(world.active_space_id == 'title', 'title did not own the presentation space')
		if frame <= test.confirm_release_frame
		or not test.title_screen.state_machines:matches_state(test.title_idle_state) then
			return false
		end
		test.title_director = director
		test.phase = 'await_gameplay'
		return host.press('AltRight', confirm_hold_frames)
	end

	if test.phase == 'await_gameplay' then
		local castle<const> = registry:get('c')
		if director == nil
		or director == test.title_director
		or castle == nil
		or world.active_space_id ~= 'main'
		or castle.current_room_number ~= 1 then
			return false
		end
		test.phase = 'settle_gameplay'
		return false
	end

	test.settle_frames = test.settle_frames + 1
	-- Pietious submits one gameplay presentation every two physical frames.
	return test.settle_frames >= 2
end
