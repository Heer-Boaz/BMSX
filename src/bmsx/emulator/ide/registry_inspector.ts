import { Table, type Value } from '../cpu';
import { Runtime } from '../runtime';
import { runConsoleChunk } from '../runtime_lua_pipeline';
import { valueToString } from '../lua_globals';
import { isStringValue, stringValueToString } from '../string_pool';
import type { ResourceBrowserItem } from './types';

const INDENT = '  ';

// Lua snippet that reads from both the Lua registry and the world's _by_id,
// returning a combined snapshot of all known Lua-side entities.
const REGISTRY_SNAPSHOT_LUA = `
local r = {}

-- 1. Explicit registry entries (from enlist() calls)
local reg = require('registry').instance
local reg_entries = {}
local ri = 0
for id, entity in pairs(reg._registry) do
	ri = ri + 1
	local info = { id = tostring(id), source = 'registry' }
	if entity.type_name then info.type_name = entity.type_name end
	if entity.registrypersistent then info.persistent = true end
	reg_entries[ri] = info
end

-- 2. World objects (from world._by_id)
local w = require('world').instance
local world_entries = {}
local wi = 0
for id, obj in pairs(w._by_id) do
	wi = wi + 1
	local info = { id = tostring(id), source = 'world' }
	if obj.type_name then info.type_name = obj.type_name end
	if obj.registrypersistent then info.persistent = true end
	if obj.active ~= nil then info.active = obj.active end
	if obj.space_id then info.space_id = obj.space_id end
	world_entries[wi] = info
end

r.registry_count = ri
r.registry_entries = reg_entries
r.world_count = wi
r.world_entries = world_entries
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

type EntityInfo = {
	id: string;
	typeName: string | null;
	persistent: boolean;
	active: boolean | null;
	spaceId: string | null;
	source: string;
};

function parseEntries(entriesTable: Value): EntityInfo[] {
	if (!(entriesTable instanceof Table)) return [];
	const list = tableArrayToList(entriesTable);
	const result: EntityInfo[] = [];
	for (let i = 0; i < list.length; i++) {
		const entry = list[i] as Table;
		if (!(entry instanceof Table)) continue;
		const id = valueToString(tableField(entry, 'id'));
		const typeName = tableField(entry, 'type_name');
		const persistent = tableField(entry, 'persistent') === true;
		const activeVal = tableField(entry, 'active');
		const spaceIdVal = tableField(entry, 'space_id');
		const sourceVal = tableField(entry, 'source');
		result.push({
			id,
			typeName: typeName !== null ? valueToString(typeName) : null,
			persistent,
			active: typeof activeVal === 'boolean' ? activeVal : null,
			spaceId: spaceIdVal !== null ? valueToString(spaceIdVal) : null,
			source: sourceVal !== null ? valueToString(sourceVal) : 'unknown',
		});
	}
	return result;
}

function buildGroupedItems(
	sectionLabel: string,
	entities: EntityInfo[],
	expandedIds: Set<string>,
	prefix: string,
	items: ResourceBrowserItem[],
): void {
	if (entities.length === 0) return;

	// Group by type_name
	const grouped = new Map<string, EntityInfo[]>();
	const ungrouped: EntityInfo[] = [];

	for (const entity of entities) {
		if (entity.typeName && entity.typeName !== 'nil') {
			let group = grouped.get(entity.typeName);
			if (!group) {
				group = [];
				grouped.set(entity.typeName, group);
			}
			group.push(entity);
		} else {
			ungrouped.push(entity);
		}
	}

	// Section header
	const sectionNodeId = `${prefix}:section`;
	const sectionExpandable = true;
	const sectionExpanded = expandedIds.has(sectionNodeId);
	const sectionMarker = sectionExpanded ? '- ' : '+ ';
	items.push({
		line: `${sectionMarker}${sectionLabel} (${entities.length})`,
		contentStartColumn: sectionMarker.length,
		descriptor: null,
		callHierarchyNodeId: sectionNodeId,
		callHierarchyExpandable: sectionExpandable,
		callHierarchyExpanded: sectionExpanded,
	});

	if (!sectionExpanded) return;

	// Sort type groups
	const sortedTypes = Array.from(grouped.keys()).sort();

	for (const typeName of sortedTypes) {
		const group = grouped.get(typeName)!;
		const nodeId = `${prefix}:${typeName}`;
		const expanded = expandedIds.has(nodeId);
		const marker = expanded ? '- ' : '+ ';

		items.push({
			line: `${INDENT}${marker}${typeName} (${group.length})`,
			contentStartColumn: INDENT.length + marker.length,
			descriptor: null,
			callHierarchyNodeId: nodeId,
			callHierarchyExpandable: true,
			callHierarchyExpanded: expanded,
		});

		if (!expanded) continue;

		for (const entity of group) {
			const tags: string[] = [];
			if (entity.persistent) tags.push('persistent');
			if (entity.active === false) tags.push('inactive');
			if (entity.spaceId) tags.push(entity.spaceId);
			const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
			items.push({
				line: `${INDENT}${INDENT}  ${entity.id}${suffix}`,
				contentStartColumn: INDENT.length * 2 + 2,
				descriptor: null,
			});
		}
	}

	if (ungrouped.length > 0) {
		const nodeId = `${prefix}:<untyped>`;
		const expanded = expandedIds.has(nodeId);
		const marker = expanded ? '- ' : '+ ';
		items.push({
			line: `${INDENT}${marker}<untyped> (${ungrouped.length})`,
			contentStartColumn: INDENT.length + marker.length,
			descriptor: null,
			callHierarchyNodeId: nodeId,
			callHierarchyExpandable: true,
			callHierarchyExpanded: expanded,
		});
		if (expanded) {
			for (const entity of ungrouped) {
				const tags: string[] = [];
				if (entity.persistent) tags.push('persistent');
				if (entity.active === false) tags.push('inactive');
				const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
				items.push({
					line: `${INDENT}${INDENT}  ${entity.id}${suffix}`,
					contentStartColumn: INDENT.length * 2 + 2,
					descriptor: null,
				});
			}
		}
	}
}

export function buildRegistryInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const runtime = Runtime.instance;
	const results = runConsoleChunk(runtime, REGISTRY_SNAPSHOT_LUA);
	const snapshot = results.length > 0 ? results[0] : null;
	if (!(snapshot instanceof Table)) {
		return [{ line: '<registry not available>', contentStartColumn: 0, descriptor: null }];
	}

	const items: ResourceBrowserItem[] = [];

	// World objects section
	const worldEntries = parseEntries(tableField(snapshot, 'world_entries'));
	const worldCount = tableField(snapshot, 'world_count');
	buildGroupedItems(
		`World Objects (${typeof worldCount === 'number' ? worldCount : worldEntries.length})`,
		worldEntries, expandedIds, 'rw', items,
	);

	// Explicit registry section
	const regEntries = parseEntries(tableField(snapshot, 'registry_entries'));
	const regCount = tableField(snapshot, 'registry_count');
	if (typeof regCount === 'number' && regCount > 0) {
		buildGroupedItems(
			`Registry (${regCount})`,
			regEntries, expandedIds, 'rg', items,
		);
	}

	if (items.length === 0) {
		items.push({ line: '<no entities>', contentStartColumn: 0, descriptor: null });
	}

	return items;
}
