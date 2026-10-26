import type { KeyValueStorage } from '../workspace/key_value_storage';

const SESSION_KEY = 'bmsx.studio.workspace-session';

export type BrowserWorkspaceSession = {
	readonly identity: string;
	activate(): void;
};

/** A newly created Studio window must not inherit its opener's recovery selection. */
export function createBrowserWorkspaceIdentity(storage: KeyValueStorage): string {
	const identity = crypto.randomUUID();
	storage.setItem(SESSION_KEY, identity);
	return identity;
}

/** Reuse this tab's recovery on reload; a cloned tab cannot claim a live owner's namespace. */
export function openBrowserWorkspaceSession(): Promise<BrowserWorkspaceSession> {
	return new Promise((resolve, reject) => {
		const acquire = (identity: string): void => {
			const completed = navigator.locks.request(`bmsx.studio.workspace-session:${identity}`, { ifAvailable: true }, lock => {
				if (lock === null) {
					acquire(createBrowserWorkspaceIdentity(sessionStorage));
					return;
				}
				const activate = () => { sessionStorage.setItem(SESSION_KEY, identity); };
				activate();
				resolve({ identity, activate });
				// The browser owns release at document destruction. Releasing on
				// pagehide would let another document claim a cached Studio's drafts.
				return new Promise<void>(() => {});
			});
			void completed.catch(reject);
		};
		const selected = sessionStorage.getItem(SESSION_KEY);
		acquire(selected === null ? createBrowserWorkspaceIdentity(sessionStorage) : selected);
	});
}
