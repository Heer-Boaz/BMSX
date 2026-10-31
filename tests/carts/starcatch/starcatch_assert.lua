local progression<const> = require('cartlib/progression')
local rom_dir<const> = require('cartlib/rom_dir')
local apu_slot<const>: *word = 0x08000148
local apu_status<const>: *word = 0x08000178
local apu_selected_source<const>: *word = 0x0800018c
local apu_active<const>: *word = 0x08000190
local renderer<const> = require('scene_renderer')
local meshes<const> = require('scene_meshes')
local prefab<const> = require('cartlib/world/prefab')
local object_3d<const> = require('cartlib/world/object_3d')
local gte<const> = require('cartlib/gx/gte')
local gp0<const> = require('cartlib/gx/gp0')
local gte_data<const>: *word = gte.data
local gte_command<const>: *word = gte.command
local gte_cycles<const>: *word = gte.cycles
bss renderer_packets: word[256]
prefab.define({ def_id = 'test.starcatch.renderer', class = object_3d })

return {
	kind = 'integration',
	setup = function(t)
		t:wait_until('title scene', function() return starcatch ~= nil and starcatch.phase == 'title' end, 160)
	end,
	tests = {
		['parented affine geometry and repeated render packets'] = function()
			local parent<const> = starcatch.scene:spawn('test.starcatch.renderer', {
				transform = { xx=1,xy=0.25,xz=0,yx=0.5,yy=1,yz=0.25,zx=0.25,zy=0,zz=1,ox=160,oy=120,oz=512 },
			})
			local ship<const> = starcatch.scene:spawn('test.starcatch.renderer', {
				parent=parent, position={x=3,y=4,z=5}, spin=0,bank=0,bob=3,recoil=2,hit_flash=0,dash_shield=0,
			})
			local game<const> = { player=ship,phase='title',frame=0,scene={definition={}},player_bolts={},enemy_bolts={} }
			local component<const> = { owner={game=game} }
			local body_colors<const>, head_colors<const> = {}, {}
			for _, color in ipairs(meshes.palettes[meshes.cyan]) do
				body_colors[gp0.draw_triangle | gp0.argb_to_rgb(color)] = true
			end
			for _, color in ipairs(meshes.palettes[meshes.gold]) do
				head_colors[gp0.draw_triangle | gp0.argb_to_rgb(color)] = true
			end
			-- Inspect the actual command producer and real GTE winding, not a host
			-- renderer substitute. The sink records one pass and compares the next.
			local draw<const> = { body=0,head=0,count=0,compare=false,reflected=false,
				rect=function() end,line=function() end,triangle_words=function(self,color,a,b,c)
					gte_data[gte.data_sxy0],gte_data[gte.data_sxy1],gte_data[gte.data_sxy2] = a,b,c
					*gte_command = gte.opcode_nclip
					while (*gte_cycles & 0x80000000) ~= 0 do end
					local area<const> = gte_data[gte.data_mac0]
					assert(area ~= 0 and ((area & 0x80000000) ~= 0) == self.reflected,
						'full-affine render emitted a back face or lost reflected winding')
					if body_colors[color] then self.body=self.body+1
					elseif head_colors[color] then self.head=self.head+1
					else error('render emitted an unrelated model palette') end
					local offset<const> = self.count
					if self.compare then
						assert(renderer_packets[offset]==color and renderer_packets[offset+1]==a
							and renderer_packets[offset+2]==b and renderer_packets[offset+3]==c,
							'repeated rendering changed the same affine geometry packet')
					else
						renderer_packets[offset],renderer_packets[offset+1],renderer_packets[offset+2],renderer_packets[offset+3] = color,a,b,c
					end
					self.count=offset+4
				end }
			for pass = 1, 2 do
				if pass == 2 then
					parent:set_transform(-1,-0.25,0,0.5,1,0.25,0.25,0,1,160,120,512)
					draw.reflected=true
				end
				draw.body,draw.head,draw.count,draw.compare = 0,0,0,false
				renderer.draw(component,draw)
				local count<const> = draw.count
				local body<const>, head<const> = draw.body,draw.head
				assert(body>0 and head>0, 'parent shear/reflection lost the ship or articulated head')
				draw.body,draw.head,draw.count,draw.compare = 0,0,0,true
				renderer.draw(component,draw)
				assert(draw.count==count and draw.body==body and draw.head==head,
					'repeated rendering dropped or duplicated model geometry')
			end
			ship:mark_for_disposal()
			parent:mark_for_disposal()
		end,
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
			local _, arrival_y, arrival_z = ship:get_global_position()
			assert(arrival_y > 240 and arrival_z > 512, 'arrival starts offscreen in depth')
			assert(ship.x == nil and ship.y == nil and ship.z == nil, '3D actor retains a mirrored position')
			t:wait_ticks(35)
			_, arrival_y, arrival_z = ship:get_global_position()
			assert(arrival_y < 420 and arrival_y > 198 and arrival_z < 896 and arrival_z > 512)
			assert(starcatch.shots_fired == 0, 'intro has no gameplay fire')
			assert((*apu_active & 8) ~= 0 and (*apu_status & 1) == 0)
			t:capture('arrival')
			t:wait_until('gameplay scene', function() return starcatch.phase == 'play' end, 180)
			assert(intro.closed and #intro.objects.items == 0)
			assert(starcatch.player ~= ship)
			local player_x, player_y, player_z = starcatch.player:get_global_position()
			assert(player_x == 160 and player_y == 198 and player_z == 512)
			assert(#starcatch.player_bolts == 8 and #starcatch.enemy_bolts == 4)
			t:press('ArrowUp', 8)
			player_x, player_y, player_z = starcatch.player:get_global_position()
			assert(player_y < 198)
			t:press('ArrowRight', 6)
			player_x, player_y, player_z = starcatch.player:get_global_position()
			assert(player_x > 160)
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
				local player_x<const> = match.player:get_global_position()
				local enemy_x<const> = match.enemy:get_global_position()
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
