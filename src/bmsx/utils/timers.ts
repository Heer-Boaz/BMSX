import { Clock, MonoTime } from '../platform/platform';

/**
 * wait returns a Promise that resolves after `ms` milliseconds according to the provided Clock.
 * The resolved value is the clock's current time when the timer fired.
 */
export function wait(clock: Clock, ms: number): Promise<MonoTime> {
	return new Promise((resolve) => {
		if (clock.scheduleOnce) {
			clock.scheduleOnce(ms, (t) => resolve(t));
		} else {
			setTimeout(() => resolve(clock.now()), Math.max(0, Math.floor(ms)));
		}
	});
}

/**
 * waitCancelable returns a promise plus a cancel function. Calling cancel will reject the promise
 * with an Error if the timer hasn't fired yet.
 */
export function waitCancelable(clock: Clock, ms: number): { promise: Promise<MonoTime>; cancel: () => void } {
	let cancelFn: () => void = () => { };
	const promise = new Promise<MonoTime>((resolve, reject) => {
		let active = true;
		if (clock.scheduleOnce) {
			const handle = clock.scheduleOnce(ms, (t) => {
				if (!active) return;
				active = false;
				resolve(t);
			});
			cancelFn = () => {
				if (!active) return;
				active = false;
				handle.cancel();
				reject(new Error('cancelled'));
			};
		} else {
			const id = setTimeout(() => {
				if (!active) return;
				active = false;
				resolve(clock.now());
			}, Math.max(0, Math.floor(ms)));
			cancelFn = () => {
				if (!active) return;
				active = false;
				clearTimeout(id as unknown as number);
				reject(new Error('cancelled'));
			};
		}
	});
	return { promise, cancel: cancelFn };
}
