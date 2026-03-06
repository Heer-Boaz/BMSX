import { Table, type Value } from '../cpu';
import { Runtime } from '../runtime';
import { runConsoleChunk } from '../runtime_lua_pipeline';
import { valueToString } from '../lua_globals';
import { isStringValue, stringValueToString } from '../string_pool';
import type { ResourceBrowserItem } from './types';

export const INSPECTOR_INDENT = '  ';

export function runInspectorSnapshot(luaSource: string): Table | null {
	const results = runConsoleChunk(Runtime.instance, luaSource);
	const snapshot = results.length > 0 ? results[0] : null;
	return snapshot instanceof Table ? snapshot : null;
}

export function tableField(table: Table, name: string): Value {
	const entries = table.entriesArray();
	for (let i = 0; i < entries.length; i++) {
		const [key, value] = entries[i];
		if (isStringValue(key) && stringValueToString(key) === name) return value;
	}
	return null;
}

export function tableFieldString(table: Table, name: string): string | null {
	const value = tableField(table, name);
	return value === null ? null : valueToString(value);
}

export function tableArrayToList(table: Table): Value[] {
	const entries = table.entriesArray();
	const indexed: Array<{ index: number; value: Value }> = [];
	for (let i = 0; i < entries.length; i++) {
		const [key, value] = entries[i];
		if (typeof key === 'number' && value !== null) indexed.push({ index: key, value });
	}
	indexed.sort((a, b) => a.index - b.index);
	return indexed.map(entry => entry.value);
}

export function appendInspectorNode(
	items: ResourceBrowserItem[],
	expandedIds: Set<string>,
	depth: number,
	label: string,
	nodeId: string,
	expandable: boolean,
	contentPrefix = '',
): boolean {
	const expanded = expandable && expandedIds.has(nodeId);
	const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';
	const indent = INSPECTOR_INDENT.repeat(depth);
	items.push({
		line: `${indent}${contentPrefix}${marker}${label}`,
		contentStartColumn: indent.length + contentPrefix.length + marker.length,
		descriptor: null,
		callHierarchyNodeId: nodeId,
		callHierarchyExpandable: expandable,
		callHierarchyExpanded: expanded,
	});
	return expanded;
}

export function appendInspectorLeaf(
	items: ResourceBrowserItem[],
	depth: number,
	label: string,
	contentPrefix = '',
): void {
	const indent = INSPECTOR_INDENT.repeat(depth);
	items.push({
		line: `${indent}${contentPrefix}${label}`,
		contentStartColumn: indent.length + contentPrefix.length,
		descriptor: null,
	});
}

export function appendInspectorDetail(
	items: ResourceBrowserItem[],
	depth: number,
	label: string,
	value: string,
): void {
	appendInspectorLeaf(items, depth, `${label}: ${value}`, '  ');
}
