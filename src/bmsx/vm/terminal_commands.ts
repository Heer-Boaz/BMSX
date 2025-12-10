import { $ } from '../core/game';
import { BmsxVMRuntime } from './vm_runtime';
import { clearWorkspaceSessionState } from './ide/workspace_storage';
import { ide_state } from './ide/ide_state';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceStorageKey, nukeWorkspaceState, resetWorkspaceDirtyBuffersAndStorage } from './workspace';
import { collectRuntimeStackFrames, formatRuntimeErrorLocation, formatRuntimeStackFrame } from './runtime_error_util';
import { RomLuaAsset } from '../rompack/rompack';

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
	' REBOOT           Reboot game (cold start)',
	' EXIT / QUIT      Close this application',
	' PRINT / ?        Print value or expression',
	' JSSTACK [ON/OFF] Toggle JS stack frames in console errors',
	' SYS              Show system information',
	' SYS FAULT        Show faulted state',
	' SYS FAULT CLEAR  Clear faulted state', // SYS CLEAR FAULT is also allowed
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

export class TerminalCommandDispatcher {
	private cwd = '/';
	private readonly drive = 'ROM';
	constructor(private readonly runtime: BmsxVMRuntime) {
	}

	public getPrompt(): string {
		return `${this.drive}:${this.cwd}> `;
	}

	public async handle(raw: string): Promise<boolean> {
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
			this.runtime.terminal.clearOutput()
			return true;
		}
		if (upper === 'CONT') {
			this.runtime.deactivateTerminalMode();
			return true;
		}
		if (upper === 'REBOOT') {
			await this.runtime.reloadProgramAndResetWorld();
			return true;
		}
		if (upper === 'EXIT' || upper === 'QUIT') {
			$.request_shutdown();
			return true;
		}
		if (upper === 'IDE' || upper === 'WSE') {
			this.runtime.activateEditor();
			return true;
		}
		// Support flexible spacing for WS subcommands, e.g. "WS   RESET", "WS\tEDIT", etc.
		const tokens = this.tokenize(trimmed);
		if (tokens.length >= 1 && tokens[0].toUpperCase() === 'JSSTACK') {
			this.handleJsStack(tokens);
			return true;
		}
		if (tokens.length >= 1 && tokens[0].toUpperCase() === 'SYS') {
			this.handleSys(tokens);
			return true;
		}
		if (tokens.length >= 1 && tokens[0].toUpperCase() === 'WS') {
			if (tokens.length !== 2) {
				this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
				return true;
			}
			const sub = tokens[1].toUpperCase();
			if (sub === 'RESET') { await this.runWorkspaceReset(); return true; }
			if (sub === 'NUKE') { await this.runWorkspaceNuke(); return true; }
			if (sub === 'EDIT') { this.runtime.activateEditor(); return true; }
			this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
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
			this.runtime.terminal.appendSystem(HELP_TEXT[index]);
		}
	}

	private async runWorkspaceReset() {
		this.runtime.terminal.appendStdout('Discarding dirty files...');
		await resetWorkspaceDirtyBuffersAndStorage();
		this.runtime.terminal.appendStdout('Dirty workspace buffers cleared');
	}

	private async runWorkspaceNuke() {
		this.runtime.terminal.appendStdout('Warning: this will erase workspace!');
		await nukeWorkspaceState();
		clearWorkspaceSessionState();
		this.runtime.terminal.appendStdout('Workspace data wiped');
	}

	private handleSys(tokens: string[]): void {
		if (tokens.length === 1) {
			this.printSystemInfo();
			return;
		}
		if (tokens.length === 2 && tokens[1].toUpperCase() === 'FAULT') {
			this.printFaultState();
			return;
		}
		if (tokens.length === 3) {
			const second = tokens[1].toUpperCase();
			const third = tokens[2].toUpperCase();
			if ((second === 'FAULT' && third === 'CLEAR') || (second === 'CLEAR' && third === 'FAULT')) {
				this.clearFaultState();
				return;
			}
		}
		this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
	}

	private printSystemInfo(): void {
		this.runtime.terminal.appendSystem('SYSTEM INFO');
		const lines = this.getSystemStatusLines();
		for (let index = 0; index < lines.length; index += 1) {
			this.runtime.terminal.appendStdout(lines[index]);
		}
	}

	private printFaultState(): void {
		const { lines, active } = this.getFaultStatusLines();
		this.runtime.terminal.appendSystem('FAULT STATE');
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (index === 0 && active) {
				this.runtime.terminal.appendStdout(line, 9);
				continue;
			}
			this.runtime.terminal.appendStdout(line);
		}
	}

	private clearFaultState(): void {
		const result = this.runtime.clearFaultState();
		if (!result.cleared) {
			this.runtime.terminal.appendStderr('No fault to clear');
			return;
		}
		if (result.resumedDebugger) {
			this.runtime.terminal.appendStdout('Fault cleared; debugger resumed');
			return;
		}
		this.runtime.terminal.appendStdout('Fault state cleared');
	}

	public getSystemStatusLines(): string[] {
		const overlay = this.runtime.overlayViewportSize;
		const chunkLabel = this.runtime.currentChunkName ?? '<none>';
		const vmState = this.runtime.isVmInitialized ? 'initialized' : 'not initialized';
		const suspension = this.runtime.debuggerSuspendSignal;
		const suspensionLocation = suspension
			? formatRuntimeErrorLocation(suspension.location.chunk, suspension.location.line, suspension.location.column)
			: null;
		const debuggerLabel = suspension ? `${suspension.reason} @ ${suspensionLocation ?? suspension.location.chunk}` : 'idle';
		const faultLabel = this.runtime.hasRuntimeFailed ? 'FAULTED' : 'OK';
		const root = $.rompack.project_root_path;
		const lines: string[] = [];
		lines.push(`Cart: ${$.rompack.project_root_path} (${$.cart.namespace})`);
		lines.push(`Lua VM: ${vmState} | Entry: ${chunkLabel}`);
		lines.push(`Status: ${faultLabel} | Debugger: ${debuggerLabel}`);
		lines.push(`Canonicalization: ${this.runtime.canonicalization}`);
		lines.push(`Overlay: ${this.runtime.overlayResolutionMode} ${overlay.width}x${overlay.height}`);
		if (root) {
			lines.push(`Workspace root: ${root}`);
		}
		const snapshot = this.runtime.faultSnapshot;
		if (snapshot) {
			const location = formatRuntimeErrorLocation(snapshot.chunkName, snapshot.line, snapshot.column);
			const when = new Date(snapshot.timestampMs).toISOString();
			const label = location ? `${location} - ${snapshot.message}` : snapshot.message;
			lines.push(`Last fault: ${label} @ ${when}`);
		} else {
			lines.push('Last fault: none recorded');
		}
		lines.push(`JS stack traces: ${this.runtime.jsStackEnabled ? 'ON' : 'OFF'}`);
		return lines;
	}

	public getFaultStatusLines(): { lines: string[]; active: boolean } {
		const lines: string[] = [];
		const suspension = this.runtime.debuggerSuspendSignal;
		const faultInfo = this.runtime.faultSnapshot;
		const faultFlag = this.runtime.hasRuntimeFailed || (suspension !== null && suspension.reason === 'exception');
		lines.push(`Faulted: ${faultFlag ? 'YES' : 'NO'}`);
		if (suspension) {
			const suspensionLocation = formatRuntimeErrorLocation(
				suspension.location.chunk,
				suspension.location.line,
				suspension.location.column,
			);
			lines.push(`Debugger: ${suspension.reason} @ ${suspensionLocation ?? suspension.location.chunk}`);
		} else {
			lines.push('Debugger: idle');
		}
		if (faultInfo) {
			const location = formatRuntimeErrorLocation(faultInfo.chunkName, faultInfo.line, faultInfo.column);
			if (location) {
				lines.push(`Location: ${location}`);
			}
			lines.push(`Message: ${faultInfo.message}`);
			const frames = collectRuntimeStackFrames(faultInfo.details, this.runtime.jsStackEnabled);
			if (frames.length > 0) {
				const maxStackLines = 6;
				lines.push('Stack trace:');
				for (let index = 0; index < frames.length && index < maxStackLines; index += 1) {
					lines.push(`  ${formatRuntimeStackFrame(frames[index])}`);
				}
				if (frames.length > maxStackLines) {
					lines.push(`... ${frames.length - maxStackLines} more frame(s)`);
				}
			}
			lines.push(`Recorded: ${new Date(faultInfo.timestampMs).toISOString()}`);
			return { lines, active: faultFlag };
		}
		lines.push('No fault information recorded.');
		return { lines, active: faultFlag };
	}

	private async handleLs(command: string): Promise<void> {
		const tokens = this.tokenize(command);
		if (tokens.length > 2) {
			this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
			return;
		}
		let mode = '';
		let filter: string = null;
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
			this.runtime.terminal.appendStderr(ERROR_FILE_NOT_FOUND);
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
					color = 16;
					break;
				case 'dirty':
					color = 10;
					break;
				case 'unsaved':
					color = 8;
					break;
			}
			this.runtime.terminal.appendStdout(entry.text.toUpperCase(), color);
		}
	}

	private handleJsStack(tokens: string[]): void {
		if (tokens.length === 1) {
			const enabled = this.runtime.jsStackEnabled;
			this.runtime.terminal.appendStdout(`JS stack traces ${enabled ? 'ON' : 'OFF'}`);
			return;
		}
		if (tokens.length === 2) {
			const mode = tokens[1].toUpperCase();
			if (mode === 'ON') {
				this.runtime.jsStackEnabled = true;
				this.runtime.terminal.appendStdout('JS stack traces ON');
				return;
			}
			if (mode === 'OFF') {
				this.runtime.jsStackEnabled = false;
				this.runtime.terminal.appendStdout('JS stack traces OFF');
				return;
			}
		}
		this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
	}

	private handleCd(command: string): void {
		const shortcutUp = command.toUpperCase() === 'CD..';
		const tokens = shortcutUp ? ['CD', '..'] : this.tokenize(command);
		if (tokens.length > 2) {
			this.runtime.terminal.appendStderr(ERROR_SYNTAX_ERROR);
			return;
		}
		if (tokens.length === 1) {
			this.runtime.terminal.appendStdout(this.cwd);
			return;
		}
		const targetRaw = tokens[1];
		if (targetRaw === '..') {
			this.cwd = this.parentPath(this.cwd);
			this.runtime.terminal.appendStdout(this.cwd);
			return;
		}
		if (targetRaw === '/') {
			this.cwd = '/';
			this.runtime.terminal.appendStdout(this.cwd);
			return;
		}
		const next = targetRaw.startsWith('/') ? targetRaw : `${this.cwd}/${targetRaw}`;
		const paths = this.collectPaths('-ALL');
		const hasDir = paths.some(entry => this.isAncestor(next, entry.path) || entry.path === next);
		if (!hasDir) {
			this.runtime.terminal.appendStderr(ERROR_FOLDER_NOT_FOUND);
			return;
		}
		this.cwd = next;
		this.runtime.terminal.appendStdout(this.cwd);
	}

	private tokenize(command: string): string[] {
		return command.trim().split(/\s+/);
	}

	private collectUnsavedPaths(root: string): Set<string> {
		const unsaved = new Set<string>();
		for (const context of ide_state.codeTabContexts.values()) {
			if (!context.descriptor || !context.dirty) {
				continue;
			}
			const cartPath = context.descriptor.path;
			const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
			const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
			if ($.platform.storage.getItem(storageKey) === null) {
				const normalizedPath = cartPath.startsWith('/') ? cartPath : `/${cartPath}`;
				unsaved.add(normalizedPath);
			}
		}
		return unsaved;
	}

	private collectWorkspaceEntryFlags(luaAssets: Array<RomLuaAsset>): Map<string, { hasSaved: boolean; hasDirty: boolean; hasUnsaved: boolean }> {
		const flags = new Map<string, { hasSaved: boolean; hasDirty: boolean; hasUnsaved: boolean }>();
		const root = $.rompack.project_root_path;
		const storage = $.platform.storage;
		if (!root || !storage) {
			return flags;
		}
		const unsavedPaths = this.collectUnsavedPaths(root);
		for (let index = 0; index < luaAssets.length; index += 1) {
			const asset = luaAssets[index];
			const cartPath = asset.normalized_source_path;
			const normalizedPath = cartPath.startsWith('/') ? cartPath : `/${cartPath}`;
			const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
			const dirtyKey = buildWorkspaceStorageKey(root, dirtyPath);
			const dirtyRaw = storage.getItem(dirtyKey);
			const hasDirty = dirtyRaw !== null && dirtyRaw !== undefined;

			const canonicalKey = buildWorkspaceStorageKey(root, cartPath);
			const savedRaw = storage.getItem(canonicalKey);
			const hasSaved = savedRaw !== null && savedRaw !== undefined;
			const hasUnsaved = unsavedPaths.has(normalizedPath);
			flags.set(normalizedPath, { hasSaved, hasDirty, hasUnsaved });
		}
		return flags;
	}

	private collectPaths(mode: string): PathEntry[] {
		if (mode && mode !== '-DIRTY' && mode !== '-SAVED' && mode !== '-ALL' && mode !== '-ROM') {
			this.runtime.terminal.appendStderr(ERROR_ILLEGAL_FUNCTION_CALL);
			return [];
		}
		const entries: PathEntry[] = [];
		const seen = new Set<string>();
		const pushPath = (path: string, kind: PathEntry['kind']): void => {
			const normalizedPath = path.startsWith('/') ? path : `/${path}`;
			const key = `${normalizedPath}:${kind}`;
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			entries.push({ path: normalizedPath, kind });
		};
		const includeRom = mode === '-ROM' || mode === '-ALL' || !mode;
		const includeSaved = mode === '-SAVED' || mode === '-ALL' || !mode;
		const includeDirty = mode === '-DIRTY' || mode === '-ALL' || !mode;
		const luaAssets = Object.values($.cart.chunk2lua);
		if (includeRom) {
			for (const asset of luaAssets) {
				const path = asset.source_path ?? 'help!!';
				pushPath(path, 'rom');
			}
		}
		if (includeSaved || includeDirty) {
			const workspaceFlags = this.collectWorkspaceEntryFlags(luaAssets);
			for (const [path, flag] of workspaceFlags) {
				if (includeSaved && flag.hasSaved) {
					pushPath(path, 'saved');
				}
				if (includeDirty && flag.hasDirty) {
					pushPath(path, 'dirty');
				}
				if (flag.hasUnsaved) {
					pushPath(path, 'unsaved');
				}
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
			lines.push({ text: `${name}`, kind, isDir: false });
		}
		return lines;
	}

	private filterListing(listing: Array<{ text: string; kind: PathEntryKind; isDir: boolean }>, filter: string): Array<{ text: string; kind: PathEntryKind; isDir: boolean }> {
		return listing.filter(entry => {
			return entry.text === filter;
		});
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
