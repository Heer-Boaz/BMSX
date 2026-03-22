const CART_SETTLE_MS = 500;
const SECOND_NEW_GAME_DELAY_MS = 800;

export default function schedule({ logger }) {
	globalThis.__bmsx_debug_tickrate = true;
	let requestedTitleNewGame = false;
	let requestedRoomNewGame = false;
	let cartActiveAt = 0;
	let firstRequestAt = 0;

	const poll = setInterval(() => {
		const engine = globalThis.$;
		if (!engine.initialized) {
			return;
		}
		if (!engine.is_cart_program_active()) {
			cartActiveAt = 0;
			return;
		}
		if (cartActiveAt === 0) {
			cartActiveAt = Date.now();
			logger('[boot] cart active, waiting for settle');
			return;
		}
		if (!requestedTitleNewGame) {
			if (Date.now() - cartActiveAt < CART_SETTLE_MS) {
				return;
			}
			requestedTitleNewGame = true;
			firstRequestAt = Date.now();
			logger('[boot] request title new_game');
			engine.request_new_game();
			return;
		}
		if (!requestedRoomNewGame && Date.now() - firstRequestAt >= SECOND_NEW_GAME_DELAY_MS) {
			requestedRoomNewGame = true;
			logger('[boot] request room new_game');
			engine.request_new_game();
			clearInterval(poll);
		}
	}, 20);
}
