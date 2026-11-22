local fixture<const> = require('tests/carts/nemesis_s/fixture')

require('constants')

return {
	kind = 'integration',
	tests = {
		roof_and_quay_keep_their_own_clips_and_completion = function(t)
			local _, stage<const>, player<const> = fixture.start_game(t)
			stage.actor_cue_index = stage.actor_cue_count
			stage.scrolling = false
			player:set_global_position(32, 96)

			local roof<const> = stage.scene:spawn(ids_schoorsteen_foe_def, {
				position = { x = 160, y = 48 }, stage = stage,
			})
			local quay<const> = stage.scene:spawn(ids_kadekanon_def, {
				position = { x = 216, y = 128 }, stage = stage,
			})
			local both_in<const> = function(path)
				return roof.state_machines:matches_state(roof.state_machines:bind_state_path(path))
					and quay.state_machines:matches_state(quay.state_machines:bind_state_path(path))
			end

			t:wait_until('both startup waits finish', function() return both_in('/idle') end, 120)
			assert(roof.sprite_component.imgid == assets_schoorsteen_foe_1
				and quay.sprite_component.imgid == 'kade_idle')
			assert(not roof.vulnerable and not quay.vulnerable)

			local roof_fires, quay_fires = 0, 0
			roof.events:on({ event = 'enemy.ray_fired', handler = function() roof_fires = roof_fires + 1 end })
			quay.events:on({ event = 'enemy.ray_fired', handler = function() quay_fires = quay_fires + 1 end })
			roof.state_machines:transition_to('/opening')
			quay.state_machines:transition_to('/opening')
			assert(roof.vulnerable and quay.vulnerable)
			t:wait_until('own opening frames', function()
				return roof.sprite_component.imgid == assets_stadsburg_laser_charged
					and quay.sprite_component.imgid == 'kade_charged'
			end, 20)
			assert(roof_fires == 0 and quay_fires == 0)
			t:wait_until('both opening clips emit their final-frame event',
				function() return both_in('/firing') end, 20)
			assert(roof_fires == 1 and quay_fires == 1
				and roof.sprite_component.imgid == assets_stadsburg_laser_firing
				and quay.sprite_component.imgid == 'kade_firing')
			t:wait_until('firing waits start both closing clips',
				function() return both_in('/closing') end, 40)
			t:wait_until('own closing frames', function()
				return roof.sprite_component.imgid == assets_schoorsteen_foe_2
					and quay.sprite_component.imgid == 'kade_fill'
			end, 6)
			t:wait_until('both closing clips emit their final-frame event',
				function() return both_in('/cooldown') end, 6)
			t:wait_until('both cooldown waits finish', function() return both_in('/idle') end, 120)
			assert(roof_fires == 1 and quay_fires == 1
				and not roof.vulnerable and not quay.vulnerable
				and roof.sprite_component.imgid == assets_schoorsteen_foe_1
				and quay.sprite_component.imgid == 'kade_idle')
		end,
	},
}
