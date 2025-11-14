import './test_setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StorageService } from '../../src/bmsx/platform/platform';
import { $ } from '../../src/bmsx/core/game';
import {
	buildDirtyFilePath,
	configureWorkspaceStorage,
	readDirtyBuffer,
	readWorkspaceStateFile,
	writeDirtyBuffer,
	writeWorkspaceStateFile,
} from '../../src/bmsx/console/ide/workspace_storage';

class MockStorage implements StorageService {
	private readonly store = new Map<string, string>();

	getItem(key: string): string | null {
		return this.store.has(key) ? this.store.get(key)! : null;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

function createPlatformStub(storage: MockStorage) {
	return {
		storage,
		lifecycle: {
			onWillExit: () => () => { /* noop */ },
		},
		clock: {
			scheduleOnce: () => ({ cancel() { /* noop */ } }),
		},
	} as const;
}

const ORIGINAL_PLATFORM = ($ as any).platform;
const ORIGINAL_FETCH = globalThis.fetch;

function useOfflinePlatform(storage: MockStorage) {
	const platformStub = createPlatformStub(storage);
	($ as any).platform = platformStub;
	const offlineFetch: typeof globalThis.fetch = async () => {
		throw new Error('offline');
	};
	globalThis.fetch = offlineFetch;
	return offlineFetch;
}

async function resetEnvironment(storage: MockStorage): Promise<void> {
	await configureWorkspaceStorage(null);
	storage.clear();
	($ as any).platform = ORIGINAL_PLATFORM;
	globalThis.fetch = ORIGINAL_FETCH;
}

test('workspace state falls back to local storage when remote backend is unavailable', async (t) => {
	const storage = new MockStorage();
	useOfflinePlatform(storage);
	t.after(() => resetEnvironment(storage));

	await configureWorkspaceStorage('offline-cart');
	await writeWorkspaceStateFile('{"session":"offline"}');

	await configureWorkspaceStorage(null);
	await configureWorkspaceStorage('offline-cart');

	const restored = await readWorkspaceStateFile();
	assert.equal(restored, '{"session":"offline"}');
});

test('dirty buffers persist via local storage between offline sessions', async (t) => {
	const storage = new MockStorage();
	useOfflinePlatform(storage);
	t.after(() => resetEnvironment(storage));

	await configureWorkspaceStorage('offline-cart');

	const dirtyPath = buildDirtyFilePath('src/foo.lua');
	await writeDirtyBuffer(dirtyPath, '-- offline cached');
	const stored = await readDirtyBuffer(dirtyPath);
	assert.equal(stored, '-- offline cached');

	await configureWorkspaceStorage(null);
	await configureWorkspaceStorage('offline-cart');

	const dirtyPathAfterRestart = buildDirtyFilePath('src/foo.lua');
	const restored = await readDirtyBuffer(dirtyPathAfterRestart);
	assert.equal(restored, '-- offline cached');
});
