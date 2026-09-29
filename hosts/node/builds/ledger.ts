import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { StudioBuildJob } from '../../common/studio_builds';

/** Durable request receipts and exclusive server ownership. OS-backed database locks die with the process. */
export class BuildLedger {
	private readonly readJob: StatementSync;
	private readonly writeJob: StatementSync;
	private constructor(private readonly database: DatabaseSync) {
		this.readJob = database.prepare('SELECT record FROM jobs WHERE id = ?');
		this.writeJob = database.prepare('INSERT INTO jobs(id, accepted_at, state, record) VALUES (?, ?, ?, ?) '
			+ 'ON CONFLICT(id) DO UPDATE SET state = excluded.state, record = excluded.record');
	}
	public static async open(root: string): Promise<BuildLedger> {
		await mkdir(root, { recursive: true });
		const database = new DatabaseSync(join(root, 'jobs.sqlite'));
		try {
			// Exclusive locking mode retains ownership between commits, without a stale PID/directory lock.
			database.exec(`PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
				BEGIN EXCLUSIVE;
				CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, accepted_at INTEGER NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL);
				CREATE INDEX IF NOT EXISTS recent_jobs ON jobs(accepted_at DESC);
				CREATE INDEX IF NOT EXISTS active_jobs ON jobs(state);
				COMMIT;`);
			return new BuildLedger(database);
		} catch (error) { database.close(); throw error; }
	}
	public read(id: string): StudioBuildJob | undefined {
		const row = this.readJob.get(id);
		return row === undefined ? undefined : JSON.parse(row.record as string);
	}
	public record(job: StudioBuildJob): void { this.writeJob.run(job.request.requestId, job.acceptedAt, job.state, JSON.stringify(job)); }
	public recent(count: number): StudioBuildJob[] {
		return this.database.prepare('SELECT record FROM jobs ORDER BY accepted_at DESC LIMIT ?').all(count).map(row => JSON.parse(row.record as string));
	}
	public unfinished(): StudioBuildJob[] {
		return this.database.prepare("SELECT record FROM jobs WHERE state IN ('queued', 'running', 'publishing')").all().map(row => JSON.parse(row.record as string));
	}
	public close(): void { this.database.close(); }
}
