const TIMEOUT_MS = 12000;

export default function schedule({ logger, test }) {
	test.run(async () => {
		const engine = await test.waitForCartActive({
			timeoutMs: TIMEOUT_MS,
			settleMs: 500,
		});
		engine.request_new_game();
		await test.pollUntil(() => {
			const [state] = test.evalLua(`
				local castle = oget('c')
				local room = oget('room')
				local player = oget('pietolon')
				return {
					ready = castle ~= nil and room ~= nil and player ~= nil,
				}
			`);
			return state.ready ? state : null;
		}, {
			timeoutMs: TIMEOUT_MS,
			description: 'pietious halo cleanup ready',
		});
		await test.waitFrames(20);

		const [state] = test.evalLua(`
			local castle_map = require('castle_map')
			local castle = oget('c')
			local room = oget('room')
			local player = oget('pietolon')
			local transition = castle_map.world_transitions_by_number[1]
			local world = require('world').instance

			local function count_leaks()
				local count = 0
				local ids = {}
				for obj in world:all_objects() do
					if obj.id ~= nil and obj.id:sub(1, 10) == 'halo.leak.' and not obj.dispose_flag then
						count = count + 1
						ids[#ids + 1] = obj.id
					end
				end
				table.sort(ids)
				return count, table.concat(ids, ',')
			end

			room:load_room(transition.world_room_number)
			castle.current_room_number = transition.world_room_number
			room.map_id = transition.world_number
			room.map_x = transition.world_map_x
			room.map_y = transition.world_map_y
			room.last_room_switch = nil

			player.inventory_items.halo = true
			player:clear_input_state()
			player:zero_motion()
			player:cancel_sword()
			player:reset_fall_substate_sequence()
			player.x = transition.world_spawn_x
			player.y = transition.world_spawn_y
			player.facing = transition.world_spawn_facing

			inst('enemy.vlokfoe', {
				id = 'halo.leak.vlok',
				space_id = 'main',
				pos = { x = 96, y = 96, z = 140 },
				speed_x_num = 0,
				speed_y_num = 0,
				speed_den = 1,
				speed_accum_x = 0,
				speed_accum_y = 0,
				rs_room_number = room.room_number,
			})
			oget('halo.leak.vlok'):add_tag('rs')
			inst('enemy.paperfoe', {
				id = 'halo.leak.paper',
				space_id = 'main',
				pos = { x = 112, y = 96, z = 140 },
				speed_x_num = 0,
				speed_y_num = 0,
				speed_den = 1,
				speed_accum_x = 0,
				speed_accum_y = 0,
				rs_room_number = room.room_number,
			})
			oget('halo.leak.paper'):add_tag('rs')

			local before_count, before_ids = count_leaks()
			local halo_result = player.actioneffects:trigger('halo')
			local after_count, after_ids = count_leaks()

			return {
				before_count = before_count,
				before_ids = before_ids,
				after_count = after_count,
				after_ids = after_ids,
				halo_result = halo_result,
				room_world_number = room.world_number,
				waiting_halo_banner = player:has_tag('v.whb'),
			}
		`);

		logger(`[assert] halo cleanup before=${state.before_count} after=${state.after_count} result=${state.halo_result}`);
		test.assert(state.before_count === 2, `expected 2 halo leak objects before trigger, got ${state.before_count}: ${state.before_ids}`);
		test.assert(state.halo_result === 'ok', `halo trigger should succeed, got ${state.halo_result}`);
		test.assert(state.room_world_number === 0, `halo should switch back to castle room, world_number=${state.room_world_number}`);
		test.assert(state.waiting_halo_banner, 'halo world return should leave player waiting on banner');
		test.assert(state.after_count === 0, `halo teleport leaked room enemies: ${state.after_ids}`);
		test.finish('[assert] halo enemy cleanup passed');
	});
}
