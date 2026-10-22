local scene_library<const> = require('cartlib/world/scene_library')

local scenes<const> = {
	title = 'starcatch.title', intro = 'starcatch.intro', play = 'starcatch.play',
	won = 'starcatch.won', over = 'starcatch.over',
}

function scenes.register()
	scene_library.register(scenes.title, {
		name = 'title', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'title', z = -1000 } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'title', x = 160, y = 130, z = 512 } },
			{ member_id = 'title', definition_id = 'starcatch.caption', options = { space_id = 'title', y = 48, z = 1000, text = 'STAR CATCH', center_block_width = 320, color = 0xffa5f5ef } },
			{ member_id = 'subtitle', definition_id = 'starcatch.caption', options = { space_id = 'title', y = 66, z = 1000, text = 'ORBITAL DEFENSE', center_block_width = 320, color = 0xffa893e3 } },
			{ member_id = 'prompt', definition_id = 'starcatch.caption', options = { space_id = 'title', y = 188, z = 1000, text = 'SPACE / A TO LAUNCH', center_block_width = 320 } },
			{ member_id = 'controls', definition_id = 'starcatch.caption', options = { space_id = 'title', y = 206, z = 1000, text = 'ARROWS MOVE   SPACE / X FIRE', center_block_width = 320, color = 0xff55c7db } },
		},
	})
	scene_library.register(scenes.intro, {
		name = 'intro', scrolling = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'intro', z = -1000 } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'intro', x = 160, y = 420, z = 896 } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = { space_id = 'intro', y = 38, z = 1000, text = 'ENTERING THE SECTOR', center_block_width = 320, color = 0xffa5f5ef } },
		},
	})
	scene_library.register(scenes.play, {
		name = 'play', scrolling = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'play', z = -1000 } },
			{ member_id = 'ship', definition_id = 'starcatch.ship', options = { player_index = 1, space_id = 'play', x = 160, y = 198, z = 512 } },
			{ member_id = 'enemy', definition_id = 'starcatch.sentinel', options = { space_id = 'play', x = 160, y = 56, z = 512 } },
			{ member_id = 'burst', definition_id = 'starcatch.burst', options = { space_id = 'play', z = 512 } },
			{ member_id = 'controls', definition_id = 'starcatch.caption', options = { space_id = 'play', y = 230, z = 1000, text = 'ARROWS MOVE   SPACE / X FIRE   SHIFT DASH', center_block_width = 320, color = 0xff55c7db } },
		},
	})
	scene_library.register(scenes.won, {
		name = 'won', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'won', z = -1000 } },
			{ member_id = 'ship', definition_id = 'starcatch.preview', options = { space_id = 'won', x = 160, y = 130, z = 512 } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = { space_id = 'won', y = 62, z = 1000, text = 'SECTOR CLEAR', center_block_width = 320, color = 0xff64dcb0 } },
			{ member_id = 'prompt', definition_id = 'starcatch.caption', options = { space_id = 'won', y = 188, z = 1000, text = 'SPACE / A TO FLY AGAIN', center_block_width = 320 } },
		},
	})
	scene_library.register(scenes.over, {
		name = 'over', launchable = true,
		objects = {
			{ member_id = 'backdrop', definition_id = 'starcatch.backdrop', options = { space_id = 'over', z = -1000 } },
			{ member_id = 'caption', definition_id = 'starcatch.caption', options = { space_id = 'over', y = 96, z = 1000, text = 'SHIP LOST', center_block_width = 320, color = 0xffed627b } },
			{ member_id = 'prompt', definition_id = 'starcatch.caption', options = { space_id = 'over', y = 154, z = 1000, text = 'SPACE / A TO RETRY', center_block_width = 320 } },
		},
	})
end

return scenes
