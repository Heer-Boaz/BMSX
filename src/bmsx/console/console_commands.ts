import { $ } from '../core/game';
import { normalizeWorkspacePath } from './workspace_paths';

type ConsoleOutputKind = 'prompt' | 'stdout' | 'stdout_saved' | 'stdout_dirty' | 'stdout_saved_dirty' | 'stderr' | 'system';

type ConsoleCommandHooks = {
	clearScreen: () => void;
	continueExecution: () => void;
	exitApplication: () => void;
	reboot: () => void;
	openEditor: () => void;
	resetWorkspace: () => void;
	nukeWorkspace: () => void;
	getWorkspaceOverrides: () => ReadonlyMap<string, { source: string; path: string | null }>;
	appendStdout: (text: string, kind?: ConsoleOutputKind) => void;
	appendStderr: (text: string) => void;
	appendSystem: (text: string) => void;
};

type PathEntry = {
	path: string;
	kind: 'rom' | 'saved' | 'dirty';
	label: string;
};

type ListingKind = 'stdout' | 'stdout_saved' | 'stdout_dirty' | 'stdout_saved_dirty';

const HELP_TEXT = [
	'----------------------------------------',
	' BMSX CONSOLE COMMAND SUMMARY',
	'----------------------------------------',
	'',
	' BASIC-LIKE COMMANDS:',
	' CLS              Clear screen',
	' CONT             Continue (after error)',
	' RESET            Reboot game (cold start)',
	' EXIT / QUIT      Close this application',
	' PRINT / ?        Print value or expression',
	' LS ROM           List assets in ROM',
	' LS               List assets in current directory',
	' LS -DIRTY / -D   List dirty workspace files',
	' LS -SAVED / =S   List saved workspace files',
	' LS -ALL / -A     List all asset in ROM + workspace',
	' CD <directory>   Change asset directory',
	' CD .. / CD..     Go up one directory level',
	' CD /             Go to root directory',
	' CD               List current directory',
	'',
	' WORKSPACE COMMANDS:',
	' WS EDIT / WSE    Open workspace editor',
	' WS RESET         Discard unsaved edits (dirty → saved)',
	' WS NUKE          Erase workspace and return to ROM-only',
	'',
	' MISC:',
	' HELP             Show this help',
	'----------------------------------------',
];

const ERROR_SYNTAX = 'SYNTAX ERROR';
const ERROR_FOLDER = 'FOLDER NOT FOUND';
const ERROR_FILE = 'FILE NOT FOUND';
const ERROR_ILLEGAL = 'ILLEGAL FUNCTION CALL';
const ERROR_NOTHING = 'NOTHING TO NUKE';

export class ConsoleCommandDispatcher {
	private cwd = '/';
	private readonly drive = 'ROM';
	private readonly hooks: ConsoleCommandHooks;

	constructor(hooks: ConsoleCommandHooks) {
		this.hooks = hooks;
	}

	public getCwd(): string {
		return this.cwd;
	}

	public setCwd(path: string): void {
		this.cwd = this.normalizePath(path);
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
			this.hooks.clearScreen();
			return true;
		}
		if (upper === 'CONT') {
			this.hooks.continueExecution();
			return true;
		}
		if (upper === 'RESET') {
			this.hooks.reboot();
			return true;
		}
		if (upper === 'EXIT' || upper === 'QUIT') {
			this.hooks.exitApplication();
			return true;
		}
		if (upper === 'IDE' || upper === 'WS EDIT' || upper === 'WSE') {
			this.hooks.openEditor();
			return true;
		}
		if (upper === 'WS') {
			this.hooks.appendStderr(ERROR_SYNTAX);
			return true;
		}
		if (upper === 'WS RESET') { this.runWorkspaceReset(); return true; }
		if (upper === 'WS NUKE') { this.runWorkspaceNuke(); return true; }
		if (upper === 'WS EDIT' || upper === 'WSE') { this.hooks.openEditor(); return true; }
		if (upper === 'WS') { this.hooks.appendStderr(ERROR_SYNTAX); return true; }
		if (upper.startsWith('WS ')) { this.hooks.appendStderr(ERROR_SYNTAX); return true; }
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
			this.hooks.appendSystem(HELP_TEXT[index]);
		}
	}

	private runWorkspaceReset(): void {
		this.hooks.appendStdout('[WS] DISCARDING DIRTY FILES...');
		this.hooks.resetWorkspace();
		this.hooks.appendStdout('[WS] RESTORED TO LAST SAVE');
	}

	private runWorkspaceNuke(): void {
		if (!this.hasWorkspaceState()) {
			this.hooks.appendStderr(ERROR_NOTHING);
			return;
		}
		this.hooks.appendStdout('[WS] WARNING: THIS WILL ERASE WORKSPACE');
		this.hooks.nukeWorkspace();
		this.hooks.appendStdout('[WS] WORKSPACE DELETED');
		this.hooks.appendStdout('[WS] REVERTED TO ROM-ONLY SOURCES');
	}

	private hasWorkspaceState(): boolean {
		const overrides = this.hooks.getWorkspaceOverrides();
		return overrides.size > 0;
	}

	private handleLs(command: string): void {
		const tokens = this.tokenize(command);
		if (tokens.length > 2) {
			this.hooks.appendStderr(ERROR_SYNTAX);
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
		if (mode && mode !== '-DIRTY' && mode !== '-SAVED' && mode !== '-ALL' && mode !== 'ROM') {
			this.hooks.appendStderr(ERROR_ILLEGAL);
			return;
		}
		const paths = this.collectPaths(mode);
		const cwd = this.cwd;
		const listing = this.buildListing(paths, cwd);
		const filtered = filter ? this.filterListing(listing, filter) : listing;
		if (filtered.length === 0) {
			this.hooks.appendStderr(ERROR_FILE);
			return;
		}
		for (let index = 0; index < filtered.length; index += 1) {
			const entry = filtered[index];
			this.hooks.appendStdout(entry.text, entry.kind);
		}
	}

	private handleCd(command: string): void {
		const shortcutUp = command.toUpperCase() === 'CD..';
		const tokens = shortcutUp ? ['CD', '..'] : this.tokenize(command);
		if (tokens.length > 2) {
			this.hooks.appendStderr(ERROR_SYNTAX);
			return;
		}
		if (tokens.length === 1) {
			this.hooks.appendStdout(this.cwd);
			return;
		}
		const targetRaw = tokens[1];
		if (targetRaw === '..') {
			this.cwd = this.parentPath(this.cwd);
			this.hooks.appendStdout(this.cwd);
			return;
		}
		if (targetRaw === '/') {
			this.cwd = '/';
			this.hooks.appendStdout(this.cwd);
			return;
		}
		const next = this.normalizePath(targetRaw.startsWith('/') ? targetRaw : `${this.cwd}/${targetRaw}`);
		const paths = this.collectPaths('ALL');
		const hasDir = paths.some(entry => this.isAncestor(next, entry.path) || entry.path === next);
		if (!hasDir) {
			this.hooks.appendStderr(ERROR_FOLDER);
			return;
		}
		this.cwd = next;
		this.hooks.appendStdout(this.cwd);
	}

	private tokenize(command: string): string[] {
		return command.trim().split(/\s+/);
	}

	private collectPaths(mode: string): PathEntry[] {
		if (mode && mode !== '-DIRTY' && mode !== '-SAVED' && mode !== '-ALL' && mode !== 'ROM') {
			this.hooks.appendStderr(ERROR_ILLEGAL);
			return [];
		}
		const rompack = $.rompack;
		const entries: PathEntry[] = [];
		const seen = new Set<string>();
		const pushPath = (path: string, kind: PathEntry['kind'], label: string): void => {
			const normalized = this.normalizePath(path);
			const key = `${normalized}:${kind}:${label}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			entries.push({ path: normalized, kind, label });
		};
		const includeRom = mode === '' || mode === 'ROM' || mode === '-ALL';
		const includeSaved = mode === '-SAVED' || mode === '-ALL' || mode === '';
		const includeDirty = mode === '-DIRTY' || mode === '-ALL';
		if (includeRom) {
			for (const entry of rompack.resourcePaths) {
				pushPath(entry.path, 'rom', `${entry.type}:${entry.asset_id}`);
			}
			for (const [asset_id, path] of Object.entries(rompack.luaSourcePaths)) {
				pushPath(path, 'rom', `lua:${asset_id}`);
			}
		}
		if (includeSaved) {
			for (const [asset_id, path] of Object.entries(rompack.luaSourcePaths)) {
				pushPath(path, 'saved', `lua:${asset_id}`);
			}
		}
		if (includeDirty) {
			const overrides = this.hooks.getWorkspaceOverrides();
			for (const [asset_id, record] of overrides) {
				const label = `ws:${asset_id}`;
				if (record.path) {
					pushPath(record.path, 'dirty', label);
				} else {
					const luaPath = rompack.luaSourcePaths[asset_id];
					if (luaPath) {
						pushPath(luaPath, 'dirty', label);
					}
				}
			}
		}
		return entries;
	}

	private buildListing(entries: PathEntry[], cwd: string): Array<{ text: string; kind: ListingKind; isDir: boolean }> {
		const dirs = new Set<string>();
		const files = new Map<string, { labels: Set<string>; hasRom: boolean; hasSaved: boolean; hasDirty: boolean }>();
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
				const existing = files.get(relative) ?? { labels: new Set<string>(), hasRom: false, hasSaved: false, hasDirty: false };
				existing.labels.add(entry.label);
				if (entry.kind === 'rom') existing.hasRom = true;
				if (entry.kind === 'saved') existing.hasSaved = true;
				if (entry.kind === 'dirty') existing.hasDirty = true;
				files.set(relative, existing);
				continue;
			}
			const dirName = relative.slice(0, slashIndex);
			dirs.add(dirName);
		}
		const lines: Array<{ text: string; kind: ListingKind; isDir: boolean }> = [];
		const sortedDirs = Array.from(dirs).sort();
		for (let i = 0; i < sortedDirs.length; i += 1) {
			lines.push({ text: `${sortedDirs[i]}/`, kind: 'stdout', isDir: true });
		}
		const sortedFiles = Array.from(files.entries()).sort((a, b) => a[0].localeCompare(b[0]));
		for (let i = 0; i < sortedFiles.length; i += 1) {
			const [name, meta] = sortedFiles[i];
			const label = Array.from(meta.labels).join(', ');
			let kind: ListingKind = 'stdout';
			if (meta.hasDirty) {
				kind = meta.hasSaved ? 'stdout_dirty' : 'stdout_dirty';
			} else if (meta.hasSaved) {
				kind = 'stdout_saved';
			}
			lines.push({ text: `${name} (${label})`, kind, isDir: false });
		}
		return lines;
	}

	private filterListing(listing: Array<{ text: string; kind: ListingKind; isDir: boolean }>, filter: string): Array<{ text: string; kind: ListingKind; isDir: boolean }> {
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
