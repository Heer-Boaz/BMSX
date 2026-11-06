import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

/** Process-owned SQLite reader/writer locks: process death releases the lease,
 * without stale PID files. Normal build/read IO shares access; collection is exclusive. */
export async function withArtifactStoreLock<T>(root: string, mode: 'shared' | 'exclusive', operation: () => Promise<T>): Promise<T> {
	await mkdir(root, { recursive: true });
	const database = new DatabaseSync(join(root, 'store-lock.sqlite'));
	let initialized = false, transaction = false;
	try {
		for (;;) {
			try {
				if (!initialized) {
					database.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS artifact_lock(id INTEGER PRIMARY KEY)');
					initialized = true;
				}
				database.exec(mode === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN');
				transaction = true;
				if (mode === 'shared') database.prepare('SELECT id FROM artifact_lock').get();
				break;
			} catch (error) {
				if (transaction) { database.exec('ROLLBACK'); transaction = false; }
				if ((error as { errcode: number }).errcode !== 5) throw error; // SQLITE_BUSY: another real lease owns the lock.
				await delay(10);
			}
		}
		return await operation();
	} finally {
		if (transaction) database.exec('COMMIT');
		database.close();
	}
}
