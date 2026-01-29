import * as bmsxNamespace from '../index';

declare global {
	// eslint-disable-next-line no-var
	var bmsx: typeof import('../index');
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: typeof import('../index') };
globalTarget.bmsx = bmsxNamespace;
