import type { TestContext } from 'node:test';

/** Node retains completed hooks for reporting. Release the one-shot callback
 * before invoking it so a finished hook cannot retain its fixture or listeners. */
export function afterTest(t: TestContext, cleanup: () => unknown): void {
	let pending: (() => unknown) | undefined = cleanup;
	t.after(() => {
		const action = pending!;
		pending = undefined;
		return action();
	});
}
