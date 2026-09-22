local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
local actioneffect_recorder<const> = require('testlib/actioneffects/recorder')
local player_actioneffects<const> = require('player/actioneffects')
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		spyglass_input = function(t)
			local _director<const>, _castle<const>, player<const> = fixture.start_game(t)
			local test<const> = {actioneffect_recorder = actioneffect_recorder.new(player.actioneffects, 4)}
			t:observe_actioneffects(test.actioneffect_recorder)
			player:equip_subweapon('spyglass')
			assert(player:has_tag(player_actioneffects.equip_tags.spyglass), 'spyglass tag missing')
			assert(not player:has_tag(player_actioneffects.equip_tags.pepernoot), 'pepernoot tag survived spyglass selection')

			t:press('KeyC', 2)
			t:wait_ticks(4)
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

		end,
	},
}
