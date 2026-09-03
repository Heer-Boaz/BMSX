local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
local actioneffect_recorder<const> = require('testlib/actioneffects/recorder')
local player_actioneffects<const> = require('player/actioneffects')

__bmsx_host_test = __bmsx_host_test or {
	phase = 'boot',
	frames = 0,
}

function __bmsx_host_test.setup()
	registry:get('d').request_new_game()
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil and registry:get('room') ~= nil and registry:get('pietolon') ~= nil and registry:get('d') ~= nil
end

function __bmsx_host_test.update(_frame, _current_music)
	local test<const> = __bmsx_host_test
	local player<const> = registry:get('pietolon')
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
		if test.actioneffect_recorder == nil then
			local recorder<const> = actioneffect_recorder.new(player.actioneffects, 4)
			test.actioneffect_recorder = recorder
			return host.observe_actioneffects(recorder)
		end
		player:equip_subweapon('spyglass')
		assert(player:has_tag(player_actioneffects.equip_tags.spyglass), 'spyglass tag missing')
		assert(not player:has_tag(player_actioneffects.equip_tags.pepernoot), 'pepernoot tag survived spyglass selection')
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
	assert(registry:get('pepernoot_1_1') == nil, 'spyglass b press spawned pepernoot')
	assert(test.actioneffect_recorder[4] == 1,
		'spyglass input did not publish one trigger attempt')
	local record<const> = test.actioneffect_recorder[5][1]
	assert(record[3] == 'trigger'
		and record[4] == 'spyglass'
		and record[5] == 'custom_gate',
		'spyglass rejection did not retain its owning custom-gate outcome')
	test.actioneffect_recorder:dispose()
	return true
end
