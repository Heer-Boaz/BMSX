local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local explosion_image_by_pose<const> = {
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
}
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		msx_timing = function(t)
			fixture.start_game(t)
			local castle<const> = registry:get('c')
			world:set_space('main')
			world:set_gameplay_clock_running(true)
			registry:get('c').room.scene:spawn('enemy_explosion', {
				id = 'probe.enemy_explosion',
				space_id = 'main',
				room = registry:get('c').room,
				player = registry:get('pietolon'),
				pos = { x = 40, y = 40, z = 113 },
			})
			registry:get('c').room.scene:spawn('world_entrance', {
				id = 'probe.world_entrance',
				space_id = 'main',
				castle = castle,
				target = 'probe_world',
				pos = { x = 80, y = 80, z = 22 },
			})
			-- The explosion's poses count gameplay updates from its own spawn; the
			-- tick on which this test observes admission depends on frame parity.
			local explosion_time_ms = world.gameplay_time_ms
			local explosion_updates = 0

			t:wait_until('timing probe admission', function()
				if world.gameplay_time_ms ~= explosion_time_ms then
					explosion_time_ms = world.gameplay_time_ms
					explosion_updates = explosion_updates + 1
				end
				return registry:get('probe.enemy_explosion') ~= nil and registry:get('probe.world_entrance') ~= nil
			end, 30)
			castle.session.world_entrances.probe_world = {state = 'closed'}
			castle:begin_open_world_entrance('probe_world')
			local gameplay_time_ms = world.gameplay_time_ms
			local step = 0
			t:wait_until('explosion poses and entrance opening', function()
				if world.gameplay_time_ms == gameplay_time_ms then return false end
				gameplay_time_ms = world.gameplay_time_ms
				step = step + 1
				explosion_updates = explosion_updates + 1
				local explosion<const> = registry:get('probe.enemy_explosion')
				local entrance<const> = registry:get('probe.world_entrance')
				if explosion ~= nil then
					local pose<const> = explosion_updates // enemy_explosion_pose_frames + 1
					assert(explosion.sprite_component.imgid == explosion_image_by_pose[pose],
					'enemy explosion left its three-update pose at step=' .. step)
				else
					assert(explosion_updates == enemy_explosion_pose_frames * #explosion_image_by_pose,
					'enemy explosion completed outside its eight three-update poses at update=' .. explosion_updates)
				end

				local phase_frames<const> = world_entrance_open_phase_frames
				if step < phase_frames then
					assert(entrance.entrance_state == 'opening_1',
					'world entrance left opening state 1 before six updates')
				elseif step < phase_frames * 2 then
					assert(entrance.entrance_state == 'opening_2',
					'world entrance did not retain opening state 2 for six updates')
				elseif step < phase_frames * 3 then
					assert(entrance.entrance_state == 'opening_3',
					'world entrance did not retain opening state 3 for six updates')
				else
					assert(entrance.entrance_state == 'open',
					'world entrance did not admit entry after all three opening phases')
				end

				return explosion == nil and entrance.entrance_state == 'open'
			end, 180)

		end,
	},
}
