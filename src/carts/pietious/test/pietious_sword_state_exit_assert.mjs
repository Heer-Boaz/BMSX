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
				local player = oget('pietolon')
				return {
					ready = player ~= nil,
				}
			`);
			return state.ready ? state : null;
		}, {
			timeoutMs: TIMEOUT_MS,
			description: 'pietious player ready',
		});
		await test.waitFrames(20);

		const [started] = test.evalLua(`
			local abilities = require('player_abilities')
			local player = oget('pietolon')
			player.sword_cooldown = 0
			return {
				activated = abilities.activate_sword(player),
				seq = player:get_timeline('p.seq.s'):value(),
				active = player:has_tag('g.sw'),
			}
		`);
		test.assert(started.activated, 'sword activation should succeed');

		await test.waitFrames(1);

		const [afterStart] = test.evalLua(`
			local player = oget('pietolon')
			return {
				seq = player:get_timeline('p.seq.s'):value(),
				active = player:has_tag('g.sw'),
			}
		`);
		test.assert(afterStart.active, `sword should be active after start: seq=${afterStart.seq}`);

		await test.waitFrames(16);

		const [finished] = test.evalLua(`
			local player = oget('pietolon')
			local machine = player.sc.statemachines.player
			return {
				seq = player:get_timeline('p.seq.s'):value(),
				active = player:has_tag('g.sw'),
				concurrent_1_current_id = machine.concurrent_states[1] and machine.concurrent_states[1].current_id or 'nil',
				cooldown = player.sword_cooldown,
			}
		`);

		test.assert(finished.concurrent_1_current_id === 'inactive', `sword machine should return to inactive, got ${finished.concurrent_1_current_id}`);
		test.assert(!finished.active, `sword tag should clear after swing, seq=${finished.seq}, cooldown=${finished.cooldown}`);
		test.finish('[assert] sword state exits cleanly');
	});
}
