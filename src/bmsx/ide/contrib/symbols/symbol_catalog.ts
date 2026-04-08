import type { LuaSymbolEntry } from '../../../emulator/types';
import * as constants from '../../core/constants';
import { computeSourceLabel } from '../references/reference_sources';
import { getActiveCodeTabContext } from '../../browser/editor_tabs';
import { ide_state } from '../../core/ide_state';
import { listGlobalLuaSymbols, listLuaSymbols } from '../intellisense/intellisense';
import { symbolKindLabel } from '../intellisense/semantic_model';
import { extractErrorMessage } from '../../../lua/luavalue';

export function symbolCatalogDedupKey(entry: LuaSymbolEntry): string {
	const { location, kind, name } = entry;
	const locationKey = location.path ? location.path : '';
	const startLine = location.range.startLine;
	const startColumn = location.range.startColumn;
	const endLine = location.range.endLine;
	const endColumn = location.range.endColumn;
	return `${kind}|${name}|${locationKey}|${startLine}:${startColumn}|${endLine}:${endColumn}`;
}

export function symbolSourceLabel(entry: LuaSymbolEntry): string | null {
	const path = entry.location.path;
	if (!path) {
		return null;
	}
	return computeSourceLabel(path);
}

export function refreshSymbolCatalog(force: boolean): void {
	const scope: 'local' | 'global' = ide_state.symbolSearchGlobal ? 'global' : 'local';
	let path: string = null;
	if (scope === 'local') {
		const context = getActiveCodeTabContext();
		path = context.descriptor.path;
	}
	const existing = ide_state.symbolCatalogContext;
	const unchanged = existing !== null
		&& existing.scope === scope
		&& (scope === 'global' || existing.path === path);
	if (!force && unchanged) {
		return;
	}
	let entries: LuaSymbolEntry[] = [];
	try {
		entries = scope === 'global'
			? listGlobalLuaSymbols()
			: listLuaSymbols(path);
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.symbolCatalog = [];
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	ide_state.symbolCatalogContext = { scope, path };
	const deduped: LuaSymbolEntry[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const key = symbolCatalogDedupKey(entry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(entry);
	}
	const catalogEntries = deduped.map((entry) => {
		const display = entry.path && entry.path.length > 0 ? entry.path : entry.name;
		const sourceLabel = scope === 'global' ? symbolSourceLabel(entry) : null;
		return {
			symbol: entry,
			displayName: display,
			searchKey: sourceLabel ? `${display} ${sourceLabel}`.toLowerCase() : display.toLowerCase(),
			line: entry.location.range.startLine,
			kindLabel: symbolKindLabel(entry.kind),
			sourceLabel,
		};
	}).sort((a, b) => {
		if (a.line !== b.line) {
			return a.line - b.line;
		}
		if (a.displayName !== b.displayName) {
			return a.displayName.localeCompare(b.displayName);
		}
		if (a.sourceLabel === b.sourceLabel) {
			return 0;
		}
		if (!a.sourceLabel) {
			return -1;
		}
		if (!b.sourceLabel) {
			return 1;
		}
		return a.sourceLabel.localeCompare(b.sourceLabel);
	});
	ide_state.symbolCatalog = catalogEntries;
}
