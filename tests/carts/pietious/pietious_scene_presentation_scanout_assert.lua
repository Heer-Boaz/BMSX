-- Pose the shipped presentation controllers for comparison with the old ROM.
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local poses<const> = {
	{ space = 'intro', owner = 'intro', state = '/playing/blank' },
	{ space = 'intro', owner = 'intro', state = '/playing/reveal', timeline = 'intro.logo.reveal', frame = 23 },
	{ space = 'intro', owner = 'intro', state = '/playing/hold' },
	{ space = 'narrative', owner = 'narrative', state = '/story/active', timeline = 'narrative.story', frame = 400 },
	{ space = 'title', owner = 'title_screen', state = '/idle', timeline = 'title_screen.sparkle', frame = 62 },
	{ space = 'title', owner = 'title_screen', state = '/starting', timeline = 'title_screen.start', frame = 20 },
	{ space = 'shrine', event = 'shrine', data = { lines = { 'HET KASTEEL', 'WACHT OP JOU' } } },
	{ space = 'lithograph', event = 'lithograph', data = { lines = { 'EEN GEHEIME TEKST', 'TWEEDE REGEL' } } },
	{ space = 'transition', event = 'transition', data = { 'WORLD 1' } },
	{ space = 'transition', event = 'death_screen' },
	{ space = 'end_demo', event = 'end_demo' },
	{ space = 'narrative', owner = 'narrative', state = '/epilogue/active', timeline = 'narrative.epilogue', frame = 400 },
	{ space = 'item', owner = 'item_screen', state = '/open' },
	{ space = 'item', owner = 'item_screen', state = '/open', world = true },
	{ space = 'main', owner = 'd', state = '/game_completion/victory_dance', player_frame = 8 },
	{ space = 'main', owner = 'd', state = '/death_curtain', timeline = 'director.curtain', frame = 7 },
}
__bmsx_host_test = { index = 0, ticks = 0 }
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup() end
function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	if test.ticks == 0 then
		test.index = test.index + 1
		if test.index > #poses then return true end
		local pose<const> = poses[test.index]
		if pose.world then
			-- Region changes happen outside inventory; its next entry binds the
			-- new region and owned items, just like normal gameplay.
			registry:get('item_screen').state_machines:transition_to('/closed')
			registry:get('c'):enter_world('world_1')
		end
		if pose.owner then
			local owner<const> = registry:get(pose.owner)
			owner.state_machines:transition_to(pose.state)
			if pose.timeline then
				owner.timelines:seek(pose.timeline, pose.frame)
				owner.timelines:set_play_rate(pose.timeline, 0)
			end
		else
			registry:get('d').events:emit(pose.event, pose.data)
		end
		if pose.player_frame then
			-- This cinematic uses the presentation clock, even while gameplay is
			-- suspended. Compare the same player pose as well as the same overlay.
			local player<const> = registry:get('pietolon')
			player.timelines:seek('p.tl.vd', pose.player_frame)
			player.timelines:set_play_rate('p.tl.vd', 0)
		end
		-- Exiting a modal state can resume gameplay. Freeze the admitted pose,
		-- after those lifecycle hooks, so its physics cannot drift during scanout.
		world:set_gameplay_clock_running(false)
		world:set_space(pose.space)
	end
	test.ticks = test.ticks + 1
	if test.ticks == 6 then
		test.ticks = 0
		return host.capture('presentation-' .. tostring(test.index))
	end
	return false
end
