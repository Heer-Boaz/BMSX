local scene_library<const> = require('cartlib/world/scene_library')

local scenes<const> = {
	title = 'starcatch.title', intro = 'starcatch.intro', play = 'starcatch.play',
	won = 'starcatch.won', over = 'starcatch.over',
}

function scenes.register()
	scene_library.register(scenes.title, {
		name = 'title', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'title' } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'title' }, spatial = { local_transform = { 1,0,0,0,1,0,0,0,1,160,130,512 } } },
			{ member_id = 'title', definition_id = 'starcatch.caption', options = {
				text = 'STAR CATCH',
				color = 0xffa5f5ef,
				space_id = 'title',
			}, spatial = { local_transform = { 1,0,0,1,0,48 } }, },
			{ member_id = 'subtitle', definition_id = 'starcatch.caption', options = {
				text = 'ORBITAL DEFENSE',
				color = 0xffa893e3,
				space_id = 'title',
			}, spatial = { local_transform = { 1,0,0,1,0,66 } }, },
		},
	})
	scene_library.register(scenes.intro, {
		name = 'intro', scrolling = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'intro' } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'intro' }, spatial = { local_transform = { 1,0,0,0,1,0,0,0,1,160,420,896 } } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = {
				text = 'ENTERING THE SECTOR',
				color = 0xffa5f5ef,
				space_id = 'intro',
			}, spatial = { local_transform = { 1,0,0,1,0,38 } }, },
		},
	})
	scene_library.register(scenes.play, {
		name = 'play', scrolling = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'play' } },
			{ member_id = 'ship', definition_id = 'starcatch.ship', options = {
				player_index = 1,
				space_id = 'play',
			}, spatial = { local_transform = { 1,0,0,0,1,0,0,0,1,160,198,512 } } },
			{ member_id = 'enemy', definition_id = 'starcatch.sentinel', options = { space_id = 'play' }, spatial = { local_transform = { 1,0,0,0,1,0,0,0,1,160,56,512 } } },
			{ member_id = 'burst', definition_id = 'starcatch.burst', options = { space_id = 'play' } },
		},
	})
	scene_library.register(scenes.won, {
		name = 'won', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'won' } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'won' }, spatial = { local_transform = { 1,0,0,0,1,0,0,0,1,160,130,512 } } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = {
				text = 'SECTOR CLEAR',
				color = 0xff64dcb0,
				space_id = 'won',
			}, spatial = { local_transform = { 1,0,0,1,0,62 } }, },
		},
	})
	scene_library.register(scenes.over, {
		name = 'over', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'over' } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = {
				text = 'SHIP LOST',
				color = 0xffed627b,
				space_id = 'over',
			}, spatial = { local_transform = { 1,0,0,1,0,96 } }, },
		},
	})
end

return scenes
