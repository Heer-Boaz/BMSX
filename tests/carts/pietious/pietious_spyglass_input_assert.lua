local world<const> = require('cartlib/world/world')
local player_abilities<const> = require('player/abilities')

__bmsx_host_test = __bmsx_host_test or {
	phase = 'boot',
	frames = 0,
}

function __bmsx_host_test.setup()
	return host.new_game()
end

function __bmsx_host_test.ready()
	return world:get('c') ~= nil and world:get('room') ~= nil and world:get('pietolon') ~= nil and world:get('d') ~= nil
end

function __bmsx_host_test.update(_frame, _current_music)
	local test<const> = __bmsx_host_test
	local player<const> = world:get('pietolon')
	if test.phase == 'boot' then
		test.frames = test.frames + 1
		if not test.ready() then
			assert(test.frames < 120, 'pietious boot timed out')
			return false
		end
		if world.active_space_id ~= 'main' then
			assert(test.frames < 240, 'pietious gameplay did not reach main space')
			return false
		end
		player:equip_subweapon('spyglass')
		assert(player:has_tag(player_abilities.equip_tags.spyglass), 'spyglass tag missing')
		assert(not player:has_tag(player_abilities.equip_tags.pepernoot), 'pepernoot tag survived spyglass selection')
		test.phase = 'press'
		return false
	end
	if test.phase == 'press' then
		test.phase = 'settle'
		test.frames = 0
		return host.press('KeyC', 2)
	end
	test.frames = test.frames + 1
	if test.frames < 4 then
		return false
	end
	assert(player.pepernoot_projectile_sequence == 0, 'spyglass b press fired pepernoot')
	assert(world:get('pepernoot_1_1') == nil, 'spyglass b press spawned pepernoot')
	return true
end
