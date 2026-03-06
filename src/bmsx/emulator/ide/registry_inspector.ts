import { Table, type Value } from '../cpu';
import { Runtime } from '../runtime';
import { runConsoleChunk } from '../runtime_lua_pipeline';
import { valueToString } from '../lua_globals';
import { isStringValue, stringValueToString } from '../string_pool';
import type { ResourceBrowserItem } from './types';

const INDENT = '  ';

// Lua snippet that traverses the registry and returns a structured snapshot.
const REGISTRY_SNAPSHOT_LUA = `
local reg = require('registry').instance
local r = {}
local entries = {}
local ei = 0
for id, entity in pairs(reg._registry) do
	ei = ei + 1
	local info = { id = tostring(id) }
	if entity.type_name then
		info.type_name = entity.type_name
	end
	if entity.registrypersistent then
		info.persistent = true
	end
	entries[ei] = info
end
table.sort(entries, function(a, b) return a.id < b.id end)
r.count = ei
r.entries = entries
return r
`;

function tableField(t: Table, name: string): Value {
	const entries = t.entriesArray();
	for (let i = 0; i < entries.length; i++) {
		const [k, v] = entries[i];
		if (isStringValue(k) && stringValueToString(k) === name) return v;
	}
	return null;
}

function tableArrayToList(t: Table): Value[] {
	const entries = t.entriesArray();
	const indexed: Array<{ index: number; value: Value }> = [];
	for (let i = 0; i < entries.length; i++) {
		const [k, v] = entries[i];
		if (typeof k === 'number' && v !== null) indexed.push({ index: k, value: v });
	}
	indexed.sort((a, b) => a.index - b.index);
	return indexed.map(e => e.value);
}

export function buildRegistryInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const runtime = Runtime.instance;
	const results = runConsoleChunk(runtime, REGISTRY_SNAPSHOT_LUA);
	const snapshot = results.length > 0 ? results[0] : null;
	if (!(snapshot instanceof Table)) {
		return [{ line: '<registry not available>', contentStartColumn: 0, descriptor: null }];
	}

	const totalCount = tableField(snapshot, 'count');
	const entriesArray = tableField(snapshot, 'entries') as Table;
	if (!(entriesArray instanceof Table)) {
		return [{ line: '<registry empty>', contentStartColumn: 0, descriptor: null }];
	}

	const entries = tableArrayToList(entriesArray);
	const items: ResourceBrowserItem[] = [];

	// Group by type_name
	const grouped = new Map<string, Array<{ id: string; persistent: boolean; table: Table }>>();
	const ungrouped: Array<{ id: string; persistent: boolean; table: Table }> = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] as Table;
		if (!(entry instanceof Table)) continue;
		const id = valueToString(tableField(entry, 'id'));
		const typeName = tableField(entry, 'type_name');
		const persistent = tableField(entry, 'persistent') === true;
		const typeStr = typeName !== null ? valueToString(typeName) : null;

		const info = { id, persistent, table: entry };
		if (typeStr && typeStr !== 'nil') {
			let group = grouped.get(typeStr);
			if (!group) {
				group = [];
				grouped.set(typeStr, group);
			}
			group.push(info);
		} else {
			ungrouped.push(info);
		}
	}

	// Sort type groups
	const sortedTypes = Array.from(grouped.keys()).sort();

	// Render grouped entries
	for (const typeName of sortedTypes) {
		const group = grouped.get(typeName)!;
		const nodeId = `rg:${typeName}`;
		const expandable = group.length > 0;
		const expanded = expandable && expandedIds.has(nodeId);
		const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';

		items.push({
			line: `${marker}${typeName} (${group.length})`,
			contentStartColumn: marker.length,
			descriptor: null,
			callHierarchyNodeId: nodeId,
			callHierarchyExpandable: expandable,
			callHierarchyExpanded: expanded,
		});

		if (!expanded) continue;

		for (let gi = 0; gi < group.length; gi++) {
			const { id, persistent } = group[gi];
			const tag = persistent ? ' [persistent]' : '';
			items.push({
				line: `${INDENT}  ${id}${tag}`,
				contentStartColumn: INDENT.length + 2,
				descriptor: null,
			});
		}
	}

	// Render ungrouped entries
	if (ungrouped.length > 0) {
		const nodeId = 'rg:<untyped>';
		const expandable = ungrouped.length > 0;
		const expanded = expandable && expandedIds.has(nodeId);
		const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';

		items.push({
			line: `${marker}<untyped> (${ungrouped.length})`,
			contentStartColumn: marker.length,
			descriptor: null,
			callHierarchyNodeId: nodeId,
			callHierarchyExpandable: expandable,
			callHierarchyExpanded: expanded,
		});

		if (expanded) {
			for (let ui = 0; ui < ungrouped.length; ui++) {
				const { id, persistent } = ungrouped[ui];
				const tag = persistent ? ' [persistent]' : '';
				items.push({
					line: `${INDENT}  ${id}${tag}`,
					contentStartColumn: INDENT.length + 2,
					descriptor: null,
				});
			}
		}
	}

	if (items.length === 0) {
		items.push({ line: '<registry empty>', contentStartColumn: 0, descriptor: null });
	}

	// Prepend total count
	items.unshift({
		line: `Total: ${typeof totalCount === 'number' ? totalCount : entries.length}`,
		contentStartColumn: 0,
		descriptor: null,
	});

	return items;
}
