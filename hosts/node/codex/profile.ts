import { chmod, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexAdmissionError } from './protocol';
import { ProcessScope, ProcessScopeBusyError } from '../process_scope/scope';

/** Persistent, separately connected account; exclusive, private process lifetime. No project cwd. */
export class CodexProfile {
	public readonly cwd: string;
	public readonly codexHome: string;
	public readonly env: NodeJS.ProcessEnv;
	private readonly lease: string;
	private released: Promise<void> | undefined;

	private constructor(root: string, public readonly scope: ProcessScope) {
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
		const root = await realpath(directory);
		await chmod(directory, 0o700);
		let scope: ProcessScope;
		try { scope = await ProcessScope.acquire(join(root, 'owner.lock')); }
		catch (error) {
			if (!(error instanceof ProcessScopeBusyError)) throw error;
			throw new CodexAdmissionError('Another Studio owns the Codex account profile. Close that session before connecting.');
		}
		const profile = new CodexProfile(root, scope);
		try {
			// Admission requires BOTH the OS lock and a completed previous release.
			// Lock availability alone says nothing about orphaned background writers.
			await rm(profile.lease, { recursive: true, force: true });
			await mkdir(profile.lease, { mode: 0o700 });
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
	 * The supervisor retains the kernel lock across descendant exit and scratch
	 * removal. Host death closes its control channel and lets it complete that
	 * same exit barrier independently. Account credentials are never removed.
	 */
	public release(): Promise<void> {
		return this.released ??= (async () => {
			try {
				await this.scope.join();
				await rm(this.lease, { recursive: true, force: true });
			}
			finally { await this.scope.release(); }
		})();
	}
}
