import { chmod, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexAdmissionError } from './protocol';

/** Persistent, separately connected account; exclusive, private process lifetime. No project cwd. */
export class CodexProfile {
	public readonly cwd: string;
	public readonly codexHome: string;
	public readonly env: NodeJS.ProcessEnv;
	private readonly lease: string;

	private constructor(root: string) {
		this.lease = join(root, 'lease');
		this.cwd = join(this.lease, 'workspace');
		this.codexHome = join(root, 'account');
		// No spread of process.env: API keys, NODE_OPTIONS, global Codex/MCP settings,
		// proxy injection and the user's HOME/XDG configuration do not cross this boundary.
		this.env = { PATH: process.env.PATH, HOME: join(this.lease, 'home'), CODEX_HOME: this.codexHome,
			TMPDIR: join(this.lease, 'tmp'), TMP: join(this.lease, 'tmp'), TEMP: join(this.lease, 'tmp'),
			XDG_CONFIG_HOME: join(this.lease, 'home'), XDG_DATA_HOME: join(this.lease, 'home'),
			USERPROFILE: join(this.lease, 'home'), SystemRoot: process.env.SystemRoot };
	}

	public static async acquire(directory: string): Promise<CodexProfile> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const profile = new CodexProfile(await realpath(directory));
		await chmod(directory, 0o700);
		// Exclusive ownership, not a stale-lock recovery heuristic. A concurrent owner fails.
		try { await mkdir(profile.lease, { mode: 0o700 }); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			throw new CodexAdmissionError(`Another Studio owns the Codex account profile, or one was killed before releasing it. `
				+ `Close the other Studio, or remove ${profile.lease} to recover.`);
		}
		try {
			await mkdir(profile.codexHome, { recursive: true, mode: 0o700 });
			for (const directory of [profile.cwd, profile.env.HOME, profile.env.TMPDIR]) {
				await mkdir(directory, { mode: 0o700 });
			}
			return profile;
		} catch (error) {
			await profile.release();
			throw error;
		}
	}

	/**
	 * Only call after joining process shutdown. An abrupt host exit cannot await
	 * that barrier and must leave the lease held, not permit a concurrent owner.
	 * Account credentials are never copied or removed here.
	 */
	public async release(): Promise<void> {
		await rm(this.lease, { recursive: true });
	}
}
