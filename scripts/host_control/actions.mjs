/** User gestures over the shared TS/native input protocol; no IDE commands. */
export async function performHostControlAction(action, send) {
	switch (action.execute) {
		case 'press': {
			const keys = action.keys.split('+');
			await send({ execute: 'input', events: keys.map(code => ({ type: 'key', code, down: true })) });
			return send({ execute: 'input', events: keys.reverse().map(code => ({ type: 'key', code, down: false })) });
		}
		case 'click': {
			const { x, y, button = 'primary' } = action;
			await send({ execute: 'input', events: [
				{ type: 'pointer', x, y }, { type: 'button', button, down: true },
			] });
			return send({ execute: 'input', events: [{ type: 'button', button, down: false }] });
		}
		case 'drag': {
			const { path, button = 'primary' } = action;
			await send({ execute: 'input', events: [
				{ type: 'pointer', x: path[0][0], y: path[0][1] }, { type: 'button', button, down: true },
			] });
			for (let index = 1; index < path.length; index += 1) {
				await send({ execute: 'input', events: [{ type: 'pointer', x: path[index][0], y: path[index][1] }] });
			}
			return send({ execute: 'input', events: [{ type: 'button', button, down: false }] });
		}
		case 'paste':
			await send({ execute: 'clipboard-set', text: action.text });
			return performHostControlAction({ execute: 'press', keys: 'ControlLeft+KeyV' }, send);
		default:
			return send(action);
	}
}
