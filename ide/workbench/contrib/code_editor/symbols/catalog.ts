import type { LuaSymbolEntry } from '../../../../../toolchain/ts/lua/semantic_contracts';
import * as constants from '../../../../common/constants';
import { computeSourceLabel } from '../../../../common/paths';
import { editorDocumentState } from '../../../../editor/editing/document_state';
import { showEditorMessage } from '../../../../common/feedback_state';
import { listGlobalLuaSymbols, listLuaSymbols } from '../../../../editor/contrib/intellisense/engine';
import { symbolKindLabel } from '../../../../../toolchain/ts/lua/semantic/model';
import { extractErrorMessage } from '../../../../language/lua/interpreter/value';
import { symbolSearchState } from './search/state';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';

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

export function refreshSymbolCatalog(bridge: RuntimeLuaTooling, force: boolean): void {
	const scope: 'local' | 'global' = symbolSearchState.global ? 'global' : 'local';
	const descriptor = editorDocumentState.resource;
	const path = scope === 'local' ? descriptor.path : null;
	const existing = symbolSearchState.catalogContext;
	const unchanged = existing !== null
		&& existing.scope === scope
		&& existing.domain === descriptor.domain
		&& (scope === 'global' || existing.path === path);
	if (!force && unchanged) {
		return;
	}
	let entries: LuaSymbolEntry[] = [];
	try {
		entries = scope === 'global'
			? listGlobalLuaSymbols(bridge, descriptor.domain)
			: listLuaSymbols(bridge, descriptor.domain, path);
	} catch (error) {
		const message = extractErrorMessage(error);
		symbolSearchState.catalog = [];
		symbolSearchState.matches = [];
		symbolSearchState.selectionIndex = -1;
		symbolSearchState.displayOffset = 0;
		symbolSearchState.hoverIndex = -1;
		showEditorMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	symbolSearchState.catalogContext = { scope, domain: descriptor.domain, path };
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
			searchKey: sourceLabel ? `${display} ${sourceLabel}` : display,
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
	symbolSearchState.catalog = catalogEntries;
}
