local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')
local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local seal_source_address<const> = rom_dir.audio('seal_breakdown').addr
local appearance_source_address<const> = rom_dir.audio('music_daemonappears').addr
local fight_source_address<const> = rom_dir.audio('music_daemonfight').addr
local cloud_positions<const> = {
	152, 96,
	144, 128,
	80, 96,
	64, 64,
	176, 64,
	96, 128,
	128, 96,
	112, 64,
}
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		daemon_appearance = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room
			local test<const> = {seen_clouds = {}, seen_cloud_count = 0}
			local from_room_number<const> = castle.current_room_number
			room = castle:load_room(100)
			castle:commit_room_switch({
				from_room_number = from_room_number,
				to_room_number = 100,
				direction = 'down',
			}, 1, 2, 5)
			player.state_machines:transition_to('/quiet')
			player.x = 32
			player.y = 96
			local enemy<const> = registry:get('c').room.scene:spawn('enemy.crossfoe', {
				id = 'probe.daemon.enemy',
				space_id = 'main',
				castle = castle,
				room = room,
				player = player,
				pos = { x = 160, y = 96, z = 110 },
			})
			enemy.cross_state = 'flying_right'
			local projectile<const> = registry:get('c').room.scene:spawn('pepernoot_projectile', {
				id = 'probe.daemon.projectile',
				space_id = 'main',
				room = room,
				room_number = 100,
				owner_id = player.id,
				direction = 1,
				pos = { x = 64, y = 96, z = 113 },
			})
			test.player_x = player.x
			test.player_y = player.y
			test.enemy_x = enemy.x
			test.enemy_y = enemy.y
			test.projectile_x = projectile.x
			test.projectile_y = projectile.y
			director.events:emit('seal.incantation_completed')

			t:wait_until('seal freezes gameplay', function() return not world.gameplay_clock_running end, 30)
			local seal_timeline<const> = director.timelines:get('director.seal')
			t:wait_until('seal dissolution', function()
				if not seal_timeline.playing then return true end
				assert(not world.gameplay_clock_running,
				'gameplay resumed before the dissolve timeline finished')
				assert(player.x == test.player_x and player.y == test.player_y,
				'player moved while the summon state paused gameplay')
				local enemy<const> = registry:get('probe.daemon.enemy')
				assert(enemy.x == test.enemy_x and enemy.y == test.enemy_y,
				'enemy moved while the summon state paused gameplay')
				local projectile<const> = registry:get('probe.daemon.projectile')
				assert(projectile.x == test.projectile_x and projectile.y == test.projectile_y,
				'projectile moved while the summon state paused gameplay')
				local frame<const> = seal_timeline.head
				if frame < flow_seal_flash_frames then
					local flash<const> = director.effects.seal_backdrop.visible
					assert(flash == ((frame & 3) < 2),
					'daemon backdrop flash differs from the MSX two-update phase')
				end
				*apu_slot = 1
				if frame >= 0 and *selected_apu_source == seal_source_address then
					test.saw_seal_audio = true
				end
				if frame == flow_seal_flash_frames - 1 then
					assert(room.seal_dissolve_step == 0 and room.room_dissolve_step == 0,
					'dissolve began before the 60-VBlank flash completed')
					test.saw_flash_end = true
				elseif frame == flow_seal_flash_frames then
					assert(room.seal_dissolve_step == 1 and room.room_dissolve_step == 0,
					'seal pattern range did not dissolve first')
					test.saw_seal_start = true
				elseif frame == flow_seal_flash_frames + flow_seal_sprite_dissolve_frames - 1 then
					assert(room.seal_dissolve_step == flow_seal_sprite_dissolve_steps
					and room.room_dissolve_step == 0,
					'seal dissolve did not finish before the room background')
					test.saw_seal_end = true
				elseif frame == flow_seal_flash_frames + flow_seal_sprite_dissolve_frames then
					assert(room.seal_dissolve_step == flow_seal_sprite_dissolve_steps
					and room.room_dissolve_step == 1,
					'room background did not begin after the seal disappeared')
					test.saw_room_start = true
				elseif frame == flow_seal_dissolution_frames - 1 then
					assert(room.seal_dissolve_step == flow_seal_sprite_dissolve_steps
					and room.room_dissolve_step == flow_seal_room_dissolve_steps,
					'final background dissolve step was not sampled')
					test.saw_room_end = true
				end
				return false
			end, 700)
			t:wait_until('daemon clouds thaw gameplay', function() return world.gameplay_clock_running end, 30)
			assert(test.saw_seal_audio, 'seal breakdown cue was not selected at freeze start')
			assert(test.saw_flash_end and test.saw_seal_start and test.saw_seal_end
			and test.saw_room_start and test.saw_room_end,
			'seal timeline skipped an MSX summon phase boundary')

			local daemon_timeline<const> = director.timelines:get('director.daemon')
			t:wait_until('daemon cloud choreography', function()
				if not daemon_timeline.playing then return true end
				assert(world.gameplay_clock_running,
				'gameplay remained suspended during the daemon clouds')
				*apu_slot = 1
				if *selected_apu_source == appearance_source_address then
					test.saw_appearance_audio = true
				end
				local enemy<const> = registry:get('probe.daemon.enemy')
				if enemy.x ~= test.enemy_x then
					test.saw_gameplay_resume = true
				end
				for index = 1, flow_daemon_cloud_count do
					local cloud<const> = director.daemon_clouds[index]
					local animation<const> = cloud.timelines:get('daemon_cloud.anim')
					assert(animation.last_frame == flow_daemon_cloud_lifetime_frames - 1,
					'daemon cloud lifetime differs from the MSX four-state animation')
					if cloud.visible then
						if not test.seen_clouds[index] then
							local position_index<const> = index * 2 - 1
							assert(cloud.x == cloud_positions[position_index]
							and cloud.y == cloud_positions[position_index + 1],
							'daemon cloud used the wrong fixed MSX coordinate')
							assert(daemon_timeline.head - animation.head
							== flow_daemon_cloud_first_spawn_frame
							+ (index - 1) * flow_daemon_cloud_spawn_interval_frames,
							'daemon cloud spawned on the wrong countdown frame')
							test.seen_clouds[index] = true
							test.seen_cloud_count = test.seen_cloud_count + 1
						end
						local image<const> = ((animation.head // 10) & 1) == 0
						and 'daemon_smoke_small' or 'daemon_smoke_large'
						assert(cloud.sprite_component.imgid == image,
						'daemon cloud animation did not alternate every ten VBlanks')
					end
				end
				return false
			end, 700)
			assert(test.saw_appearance_audio, 'daemon appearance cue did not start at thaw')
			assert(test.saw_gameplay_resume, 'gameplay did not resume during the cloud sequence')
			assert(test.seen_cloud_count == flow_daemon_cloud_count,
			'daemon appearance did not spawn all eight MSX clouds')
			for index = 1, flow_daemon_cloud_count do
				assert(not director.daemon_clouds[index].visible,
				'daemon cloud remained visible after the appearance sequence')
			end
			*apu_slot = 1
			assert(*selected_apu_source == fight_source_address,
			'daemon fight music did not start at the appearance boundary')

		end,
	},
}
