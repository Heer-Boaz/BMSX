import { $ } from '../core/game';
import { BmsxConsoleRuntime } from './runtime';
import { normalizeWorkspacePath } from './workspace';

type PathEntryKind = 'rom' | 'saved' | 'dirty' | 'saved_dirty' | 'unsaved';

type PathEntry = {
	path: string;
	kind: PathEntryKind;
	// label: string;
};

const HELP_TEXT = [
	'----------------------------------------',
	' BMSX COMMANDS',
	'----------------------------------------',
	'',
	' COMMANDS:',
	' CLS              Clear screen',
	' CONT             Continue (after error)',
	' RESET            Reboot game (cold start)',
	' EXIT / QUIT      Close this application',
	' PRINT / ?        Print value or expression',
	' JSSTACK [ON/OFF] Toggle JS stack frames in console errors',
	' LS               List assets in current directory',
	' LS -ROM          List assets in ROM',
	' LS -DIRTY / -D   List dirty workspace files',
	' LS -SAVED / -S   List saved workspace files',
	' LS -ALL / -A     List all asset in ROM + WS',
	' CD <directory>   Change asset directory',
	' CD .. / CD..     Go up one directory level',
	' CD /             Go to root directory',
	' CD               List current directory',
	'',
	' WORKSPACE COMMANDS:',
	' WS EDIT / WSE    Open workspace editor',
	' WS RESET         Discard unsaved edits (dirty > saved)',
	' WS NUKE          Erase workspace and return to ROM-only',
	'',
	' MISC:',
	' HELP             Show this help',
	'----------------------------------------',
];

const ERROR_SYNTAX_ERROR = 'Syntax error';
const ERROR_FOLDER_NOT_FOUND = 'Folder not found';
const ERROR_FILE_NOT_FOUND = 'File not found';
const ERROR_ILLEGAL_FUNCTION_CALL = 'Illegal function call';
const ERROR_NOTHING_TO_NUKE = 'Nothing to nuke';

export class ConsoleCommandDispatcher {
	private cwd = '/';
	private readonly drive = 'ROM';
	constructor(private readonly runtime: BmsxConsoleRuntime) {
	}

	public getPrompt(): string {
		return `${this.drive}:${this.cwd}> `;
	}

	public handle(raw: string): boolean {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			return true;
		}
		const upper = trimmed.toUpperCase();
		if (upper === 'HELP') {
			this.printHelp();
			return true;
		}
		if (upper === 'CLS') {
			this.runtime.consoleMode.clearOutput()
			return true;
		}
		if (upper === 'CONT') {
			this.runtime.continueFromConsole();
			return true;
		}
		if (upper === 'RESET') {
			this.runtime.boot();
			return true;
		}
		if (upper === 'EXIT' || upper === 'QUIT') {
			$.request_shutdown();
			return true;
		}
		if (upper === 'IDE' || upper === 'WSE') {
			this.runtime.openEditor();
			return true;
		}
		// Support flexible spacing for WS subcommands, e.g. "WS   RESET", "WS\tEDIT", etc.
		const tokens = this.tokenize(trimmed);
		if (tokens.length >= 1 && tokens[0].toUpperCase() === 'JSSTACK') {
			this.handleJsStack(tokens);
			return true;
		}
		if (tokens.length >= 1 && tokens[0].toUpperCase() === 'WS') {
			if (tokens.length !== 2) {
				this.runtime.consoleMode.appendStderr(ERROR_SYNTAX_ERROR);
				return true;
			}
			const sub = tokens[1].toUpperCase();
			if (sub === 'RESET') { this.runWorkspaceReset(); return true; }
			if (sub === 'NUKE') { this.runWorkspaceNuke(); return true; }
			if (sub === 'EDIT') { this.runtime.openEditor(); return true; }
			this.runtime.consoleMode.appendStderr(ERROR_SYNTAX_ERROR);
			return true;
		}
		if (upper === 'LS' || upper.startsWith('LS ')) {
			this.handleLs(trimmed);
			return true;
		}
		if (upper === 'CD' || upper.startsWith('CD ')) {
			this.handleCd(trimmed);
			return true;
		}
		return false;
	}

	private printHelp(): void {
		for (let index = 0; index < HELP_TEXT.length; index += 1) {
			this.runtime.consoleMode.appendSystem(HELP_TEXT[index]);
		}
	}

	private runWorkspaceReset(): void {
		this.runtime.consoleMode.appendStdout('Discarding dirty files...');
		void this.runtime.clearWorkspaceLuaOverrides().then(() => {
			this.runtime.consoleMode.appendStdout('Restored to saved workspace');
		});
	}

	private runWorkspaceNuke(): void {
		if (!this.hasWorkspaceState()) {
			this.runtime.consoleMode.appendStderr(ERROR_NOTHING_TO_NUKE);
			return;
		}
		this.runtime.consoleMode.appendStdout('Warning: this will erase workspace!');
		void this.runtime.nukeWorkspace().then(() => {
			this.runtime.consoleMode.appendStdout('Workspace deleted');
			this.runtime.consoleMode.appendStdout('Reverted to saved workspace sources');
		});
	}

	private hasWorkspaceState(): boolean {
		const overrides = this.runtime.workspaceLuaOverrides;
		return overrides.size > 0;
	}

	private handleLs(command: string): void {
		const tokens = this.tokenize(command);
		if (tokens.length > 2) {
			this.runtime.consoleMode.appendStderr(ERROR_SYNTAX_ERROR);
			return;
		}
		let mode = '';
		let filter: string | null = null;
		if (tokens.length >= 2) {
			const arg = tokens[1];
			if (arg.startsWith('-')) {
				mode = arg.toUpperCase();
			} else {
				filter = arg;
			}
		}
		if (mode === '-D') mode = '-DIRTY';
		if (mode === '-S' || mode === '=S') mode = '-SAVED';
		if (mode === '-A') mode = '-ALL';
		const paths = this.collectPaths(mode);
		const cwd = this.cwd;
		const listing = this.buildListing(paths, cwd);
		const filtered = filter ? this.filterListing(listing, filter) : listing;
		if (filtered.length === 0) {
			this.runtime.consoleMode.appendStderr(ERROR_FILE_NOT_FOUND);
			return;
		}
			for (let index = 0; index < filtered.length; index += 1) {
				const entry = filtered[index];
				let color;
				switch (entry.kind) {
					case 'rom':
						color = 15;
						break;
					case 'saved':
						color = 2;
						break;
					case 'saved_dirty':
						color = 13;
						break;
					case 'dirty':
						color = 5;
						break;
					case 'unsaved':
						color = 6;
						break;
				}
				this.runtime.consoleMode.appendStdout(entry.text.toUpperCase(), color);
			}
		}

	private handleJsStack(tokens: string[]): void {
		if (tokens.length === 1) {
			const enabled = this.runtime.consoleJsStackEnabled;
			this.runtime.consoleMode.appendStdout(`JS stack traces ${enabled ? 'ON' : 'OFF'}`);
			return;
		}
		if (tokens.length === 2) {
			const mode = tokens[1].toUpperCase();
			if (mode === 'ON') {
				this.runtime.consoleJsStackEnabled = true;
				this.runtime.consoleMode.appendStdout('JS stack traces ON');
				return;
			}
			if (mode === 'OFF') {
				this.runtime.consoleJsStackEnabled = false;
				this.runtime.consoleMode.appendStdout('JS stack traces OFF');
				return;
			}
		}
		this.runtime.consoleMode.appendStderr(ERROR_SYNTAX_ERROR);
	}

	private handleCd(command: string): void {
		const shortcutUp = command.toUpperCase() === 'CD..';
		const tokens = shortcutUp ? ['CD', '..'] : this.tokenize(command);
		if (tokens.length > 2) {
			this.runtime.consoleMode.appendStderr(ERROR_SYNTAX_ERROR);
			return;
		}
		if (tokens.length === 1) {
			this.runtime.consoleMode.appendStdout(this.cwd);
			return;
		}
		const targetRaw = tokens[1];
		if (targetRaw === '..') {
			this.cwd = this.parentPath(this.cwd);
			this.runtime.consoleMode.appendStdout(this.cwd);
			return;
		}
		if (targetRaw === '/') {
			this.cwd = '/';
			this.runtime.consoleMode.appendStdout(this.cwd);
			return;
		}
		const next = this.normalizePath(targetRaw.startsWith('/') ? targetRaw : `${this.cwd}/${targetRaw}`);
		const paths = this.collectPaths('-ALL');
		const hasDir = paths.some(entry => this.isAncestor(next, entry.path) || entry.path === next);
		if (!hasDir) {
			this.runtime.consoleMode.appendStderr(ERROR_FOLDER_NOT_FOUND);
			return;
		}
		this.cwd = next;
		this.runtime.consoleMode.appendStdout(this.cwd);
	}

	private tokenize(command: string): string[] {
		return command.trim().split(/\s+/);
	}

	private collectPaths(mode: string): PathEntry[] {
		if (mode && mode !== '-DIRTY' && mode !== '-SAVED' && mode !== '-ALL' && mode !== '-ROM') {
			this.runtime.consoleMode.appendStderr(ERROR_ILLEGAL_FUNCTION_CALL);
			return [];
		}
		const rompack = $.rompack;
		const entries: PathEntry[] = [];
		const seen = new Set<string>();
		const pushPath = (path: string, kind: PathEntry['kind']): void => {
			const normalized = this.normalizePath(path);
			const key = `${normalized}:${kind}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			entries.push({ path: normalized, kind });
		};
		const includeRom = mode === '-ROM' || mode === '-ALL' || !mode;
		const includeSaved = mode === '-SAVED' || mode === '-ALL' || !mode;
		const includeDirty = mode === '-DIRTY' || mode === '-ALL' || !mode;
		const savedAssets = includeSaved ? this.runtime.getWorkspaceSavedAssetIds() : new Set<string>();
		const scratchPaths = includeDirty ? this.runtime.workspaceScratchPaths : new Set<string>();
		if (includeRom) {
			for (const entry of rompack.resourcePaths) {
				pushPath(entry.path, 'rom');
			}
			for (const [_, path] of Object.entries(rompack.luaSourcePaths)) {
				pushPath(path, 'rom');
			}
		}
		if (includeSaved) {
			for (const [asset_id, path] of Object.entries(rompack.luaSourcePaths)) {
				if (savedAssets.has(asset_id)) {
					pushPath(path, 'saved');
				}
			}
		}
		if (includeDirty) {
			const overrides = this.runtime.workspaceLuaOverrides;
			for (const [asset_id, record] of overrides) {
				const targetPath = record.cartPath ?? rompack.luaSourcePaths[asset_id];
				if (targetPath) {
					pushPath(targetPath, 'dirty');
				}
			}
			for (const path of scratchPaths) {
				pushPath(path, 'unsaved');
			}
		}
		return entries;
	}

	private buildListing(entries: PathEntry[], cwd: string): Array<{ text: string; kind: PathEntryKind; isDir: boolean }> {
		const dirs = new Set<string>();
		const files = new Map<string, { labels: Set<string>; hasRom: boolean; hasSaved: boolean; hasDirty: boolean; hasUnsaved: boolean }>();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (!this.isAncestor(cwd, entry.path) && entry.path !== cwd) {
				continue;
			}
			const relative = this.relativePath(cwd, entry.path);
			if (relative.length === 0) {
				continue;
			}
			const slashIndex = relative.indexOf('/');
			if (slashIndex === -1) {
				const existing = files.get(relative) ?? { labels: new Set<string>(), hasRom: false, hasSaved: false, hasDirty: false, hasUnsaved: false };
				// existing.labels.add(entry.label);
				if (entry.kind === 'rom') existing.hasRom = true;
				if (entry.kind === 'saved') existing.hasSaved = true;
				if (entry.kind === 'dirty') existing.hasDirty = true;
				if (entry.kind === 'unsaved') existing.hasUnsaved = true;
				files.set(relative, existing);
				continue;
			}
			const dirName = relative.slice(0, slashIndex);
			dirs.add(dirName);
		}
		const lines: Array<{ text: string; kind: PathEntryKind; isDir: boolean }> = [];
		const sortedDirs = Array.from(dirs).sort();
		for (let i = 0; i < sortedDirs.length; i += 1) {
			lines.push({ text: `${sortedDirs[i]}/`, kind: 'rom', isDir: true });
		}
		const sortedFiles = Array.from(files.entries()).sort((a, b) => a[0].localeCompare(b[0]));
		for (let i = 0; i < sortedFiles.length; i += 1) {
			const [name, meta] = sortedFiles[i];
			// const label = Array.from(meta.labels).join(', ');
			let kind: PathEntryKind = 'rom';
			if (meta.hasDirty && meta.hasSaved) {
				kind = 'saved_dirty';
			} else if (meta.hasDirty) {
				kind = 'dirty';
			} else if (meta.hasSaved) {
				kind = 'saved';
			} else if (meta.hasUnsaved) {
				kind = 'unsaved';
			}
			// lines.push({ text: `${name} (${label})`, kind, isDir: false });
			lines.push({ text: `${name}`, kind, isDir: false });
		}
		return lines;
	}

	private filterListing(listing: Array<{ text: string; kind: PathEntryKind; isDir: boolean }>, filter: string): Array<{ text: string; kind: PathEntryKind; isDir: boolean }> {
		const normalized = filter.replace(/\/+$/, '');
		return listing.filter(entry => {
			const target = entry.text.replace(/\/+$/, '');
			return target === normalized;
		});
	}

	private normalizePath(path: string): string {
		const normalized = normalizeWorkspacePath(path);
		if (normalized.length === 0) {
			return '/';
		}
		return normalized.startsWith('/') ? normalized : `/${normalized}`;
	}

	private parentPath(path: string): string {
		if (path === '/' || path.length === 0) {
			return '/';
		}
		const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
		const index = trimmed.lastIndexOf('/');
		if (index <= 0) {
			return '/';
		}
		return trimmed.slice(0, index);
	}

	private isAncestor(base: string, candidate: string): boolean {
		const normalizedBase = base === '/' ? '/' : `${base}/`;
		if (normalizedBase === '/' && candidate === '/') {
			return true;
		}
		if (normalizedBase === '/') {
			return candidate.startsWith('/');
		}
		return candidate.startsWith(normalizedBase);
	}

	private relativePath(base: string, target: string): string {
		if (base === '/') {
			return target.startsWith('/') ? target.slice(1) : target;
		}
		const prefix = `${base}/`;
		return target.startsWith(prefix) ? target.slice(prefix.length) : '';
	}
}
