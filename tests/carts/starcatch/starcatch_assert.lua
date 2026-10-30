local progression<const> = require('cartlib/progression')
local rom_dir<const> = require('cartlib/rom_dir')
local apu_slot<const>: *word = 0x08000148
local apu_status<const>: *word = 0x08000178
local apu_selected_source<const>: *word = 0x0800018c
local apu_active<const>: *word = 0x08000190

return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('title scene', function() return starcatch ~= nil and starcatch.phase == 'title' end, 160)
	end,
	tests = {
		['real scenes, 3D arrival, movement and ActionEffect fire'] = function(t)
			local title<const> = starcatch.scene
			assert(title.definition.name == 'title')
			assert(not starcatch.world.gameplay_clock_running)
			t:capture('title')
			t:press('Space', 1)
			t:wait_until('intro scene', function() return starcatch.phase == 'intro' end, 12)
			assert(title.closed and #title.objects.items == 0, 'old composition must be unloaded')
			t:wait_until('arrival audio', function()
				*apu_slot = 3
				return (*apu_active & 8) ~= 0 and *apu_selected_source == rom_dir.audio('arrival').addr
			end, 6)
			local intro<const> = starcatch.scene
			local ship<const> = starcatch.player
			local _start_x<const>, start_y<const>, start_z<const> = ship.spatial:world_origin()
			assert(start_y > 240 and start_z > 512, 'arrival starts offscreen in depth')
			assert(ship.x == nil and ship.y == nil and ship.z == nil, '3D actor retains a mirrored position')
			t:wait_ticks(35)
			local _arrival_x<const>, arrival_y<const>, arrival_z<const> = ship.spatial:world_origin()
			assert(arrival_y < 420 and arrival_y > 198 and arrival_z < 896 and arrival_z > 512)
			assert(starcatch.shots_fired == 0, 'intro has no gameplay fire')
			assert((*apu_active & 8) ~= 0 and (*apu_status & 1) == 0)
			t:capture('arrival')
			t:wait_until('gameplay scene', function() return starcatch.phase == 'play' end, 180)
			assert(intro.closed and #intro.objects.items == 0)
			assert(starcatch.player ~= ship)
			local play_x<const>, play_y<const>, play_z<const> = starcatch.player.spatial:world_origin()
			assert(play_x == 160 and play_y == 198 and play_z == 512)
			assert(#starcatch.player_bolts == 8 and #starcatch.enemy_bolts == 4)
			t:press('ArrowUp', 8)
			local _after_up_x<const>, after_up_y<const> = starcatch.player.spatial:world_origin()
			assert(after_up_y < 198)
			t:press('ArrowRight', 6)
			local after_right_x<const> = starcatch.player.spatial:world_origin()
			assert(after_right_x > 160)
			assert((*apu_active & 8) == 0, 'arrival voice retires before gameplay fire')
			t:down('Space')
			t:wait_until('player shot audio', function()
				return (*apu_active & 1) ~= 0 and *apu_selected_source == rom_dir.audio('shot').addr
			end, 8)
			t:wait_ticks(40)
			t:up('Space')
			assert(starcatch.shots_fired >= 3 and starcatch.shots_fired <= 8, 'held fire uses the effect cooldown')
			assert(starcatch.player.actioneffects.effects['starcatch.fire'].cooldown_until_ms ~= nil)
			t:capture('shooter')
		end,
		['physical shooting unlocks dash and twin cannon and clears the sector'] = function(t)
			t:press('Space', 1)
			t:wait_until('gameplay scene', function() return starcatch.phase == 'play' end, 200)
			t:down('KeyX')
			local held = ''
			local saw_charge = false
			local dashed = false
			for tick = 1, 1800 do
				local match<const> = starcatch
				if match.phase ~= 'play' then break end
				saw_charge = saw_charge or match.enemy.charge > 0
				local desired = ''
				local player_x<const> = match.player.spatial:world_origin()
				local enemy_x<const> = match.enemy.spatial:world_origin()
				if player_x < enemy_x - 2 then desired = 'ArrowRight'
				elseif player_x > enemy_x + 2 then desired = 'ArrowLeft' end
				if desired ~= held then
					if held ~= '' then t:up(held) end
					if desired ~= '' then t:down(desired) end
					held = desired
				end
				if match.dash_unlocked and not dashed then
					t:press('ShiftLeft', 1)
					assert(match.dashes == 1 and match.player.dash_shield > 0)
					dashed = true
				end
				t:wait_ticks(1)
			end
			if held ~= '' then t:up(held) end
			t:up('KeyX')
			assert(starcatch.phase == 'won' and starcatch.score == 12 and starcatch.lives > 0)
			assert(saw_charge and starcatch.shots_fired >= 12 and dashed)
			assert(starcatch.twin_cannon and progression.get(starcatch, 'complete'))
			assert(starcatch.scene.definition.name == 'won' and #starcatch.player_bolts == 0)
			t:wait_until('victory audio', function()
				*apu_slot = 3
				return (*apu_active & 8) ~= 0 and *apu_selected_source == rom_dir.audio('victory').addr
			end, 6)
			t:capture('sector-clear')
			t:wait_ticks(75)
			assert(*apu_active == 0 and (*apu_status & 1) == 0, 'finished stingers leave no active or faulted voice')
		end,
		['enemy BT shoots, damage effects lose lives, retry owns a fresh scene'] = function(t)
			t:press('Space', 1)
			t:wait_until('gameplay scene', function() return starcatch.phase == 'play' end, 200)
			local play<const> = starcatch.scene
			local ship<const> = starcatch.player
			t:wait_until('enemy fire', function() return starcatch.enemy_shots > 0 end, 240)
			t:wait_until('game over', function() return starcatch.phase == 'over' end, 800)
			assert(starcatch.lives == 0 and starcatch.shots_fired == 0)
			t:wait_until('defeat audio', function()
				*apu_slot = 3
				return (*apu_active & 8) ~= 0 and *apu_selected_source == rom_dir.audio('defeat').addr
			end, 6)
			assert(play.closed and #play.objects.items == 0, 'all scene-owned bolts must be disposed')
			t:press('Space', 1)
			t:wait_until('retry arrival audio', function()
				*apu_slot = 3
				return (*apu_active & 8) ~= 0 and *apu_selected_source == rom_dir.audio('arrival').addr
			end, 8)
			t:wait_until('fresh gameplay', function() return starcatch.phase == 'play' end, 200)
			assert(starcatch.player ~= ship and starcatch.score == 0 and starcatch.lives == 3)
			assert(not starcatch.dash_unlocked and not starcatch.twin_cannon)
			assert(not progression.get(starcatch, 'complete'))
			assert((*apu_status & 1) == 0)
		end,
	},
}
