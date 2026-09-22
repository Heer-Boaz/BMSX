local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local poses<const> = {
	{ phase = 'intro', state = '/playing/blank' },
	{ phase = 'intro', state = '/playing/reveal', timeline = 'nemesis_s.intro.logo_reveal', frame = 0 },
	{ phase = 'intro', state = '/playing/reveal', timeline = 'nemesis_s.intro.logo_reveal', frame = 23 },
	{ phase = 'intro', state = '/playing/reveal', timeline = 'nemesis_s.intro.logo_reveal', frame = 47 },
	{ phase = 'story', state = '/playing/slide_1', timeline = 'nemesis_s.story.slide.1', frame = 18 },
	{ phase = 'story', state = '/playing/slide_1', timeline = 'nemesis_s.story.slide.1', frame = 1190 },
	{ phase = 'story', state = '/playing/slide_2', timeline = 'nemesis_s.story.slide.2', frame = 18 },
	{ phase = 'story', state = '/playing/slide_3', timeline = 'nemesis_s.story.slide.3', frame = 18 },
	{ phase = 'story', state = '/playing/slide_4', timeline = 'nemesis_s.story.slide.4', frame = 18 },
	{ phase = 'story', state = '/playing/slide_5', timeline = 'nemesis_s.story.slide.5', frame = 18 },
	{ phase = 'story', state = '/playing/slide_6', timeline = 'nemesis_s.story.slide.6', frame = 18 },
	{ phase = 'story', state = '/playing/slide_6', timeline = 'nemesis_s.story.slide.6', frame = 158 },
	{ phase = 'story', state = '/playing/slide_6', timeline = 'nemesis_s.story.slide.6', frame = 310 },
	{ phase = 'story', state = '/playing/slide_6', timeline = 'nemesis_s.story.slide.6', frame = 500 },
	{ phase = 'story', state = '/playing/slide_6', timeline = 'nemesis_s.story.slide.6', frame = 663 },
	{ phase = 'story', state = '/playing/slide_7', timeline = 'nemesis_s.story.slide.7', frame = 18 },
	{ phase = 'story', state = '/playing/slide_8', timeline = 'nemesis_s.story.slide.8', frame = 18 },
	{ phase = 'story', state = '/playing/slide_9', timeline = 'nemesis_s.story.slide.9', frame = 18 },
	{ phase = 'end_demo', state = '/playing', timeline = 'nemesis_s.end_demo.presentation', time_ms = 240 },
	{ phase = 'end_demo', state = '/playing', timeline = 'nemesis_s.end_demo.presentation', time_ms = 18690 },
	{ phase = 'end_demo', state = '/playing', timeline = 'nemesis_s.end_demo.presentation', time_ms = 19440 },
	{ phase = 'end_demo', state = '/playing', timeline = 'nemesis_s.end_demo.presentation', time_ms = 19800 },
	{ phase = 'end_demo', state = '/playing', timeline = 'nemesis_s.end_demo.presentation', time_ms = 38250 },
	{ phase = 'game_start' },
	{ phase = 'gameplay' },
}

return {
	kind = 'integration',
	tests = {
		presentation_poses = function(t)
			t:wait_until('presentation director', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			local director<const> = registry:get('nemesis_s.director')
			local phase = ''
			for index, pose in ipairs(poses) do
				if phase ~= pose.phase then
					if pose.phase == 'end_demo' then director.state_machines:transition_to('/game_start') end
					director.state_machines:transition_to('/' .. pose.phase)
					phase = pose.phase
				end
				if pose.state then
					local owner<const> = registry:get('nemesis_s.' .. pose.phase)
					owner.state_machines:transition_to(pose.state)
					if pose.frame then owner.timelines:seek(pose.timeline, pose.frame) end
					if pose.time_ms then owner.timelines:seek_time(pose.timeline, pose.time_ms) end
					owner.timelines:set_enabled(false)
				end
				world:set_gameplay_clock_running(false)
				t:wait_ticks(3)
				t:capture('presentation-pose-' .. tostring(index))
			end
		end,
	},
}
