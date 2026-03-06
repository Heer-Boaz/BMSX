import { Table, type Value } from '../cpu';
import { Runtime } from '../runtime';
import { runConsoleChunk } from '../runtime_lua_pipeline';
import { valueToString } from '../lua_globals';
import { isStringValue, stringValueToString } from '../string_pool';
import type { ResourceBrowserItem } from './types';

const INDENT = '  ';

// Lua snippet that traverses the event emitter and returns a structured snapshot.
const EVENT_SNAPSHOT_LUA = `
local ee = require('eventemitter').eventemitter.instance
local r = {}
r.events = {}
local ei = 0
for event_name, listener_list in pairs(ee.listeners) do
	ei = ei + 1
	local le = { name = event_name, listeners = {} }
	for li = 1, #listener_list do
		local entry = listener_list[li]
		local info = { persistent = entry.persistent or false }
		if entry.subscriber then
			info.subscriber_id = entry.subscriber.id or tostring(entry.subscriber)
		end
		if entry.emitter then
			if type(entry.emitter) == 'table' then
				info.emitter_id = entry.emitter.id or tostring(entry.emitter)
			else
				info.emitter_id = tostring(entry.emitter)
			end
		end
		le.listeners[li] = info
	end
	r.events[ei] = le
end
r.any_count = #ee.any_listeners
r.any_listeners = {}
for ai = 1, #ee.any_listeners do
	local entry = ee.any_listeners[ai]
	r.any_listeners[ai] = { persistent = entry.persistent or false }
end
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

export function buildEventInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const runtime = Runtime.instance;
	const results = runConsoleChunk(runtime, EVENT_SNAPSHOT_LUA);
	const snapshot = results.length > 0 ? results[0] : null;
	if (!(snapshot instanceof Table)) {
		return [{ line: '<event emitter not available>', contentStartColumn: 0, descriptor: null }];
	}

	const items: ResourceBrowserItem[] = [];

	// Named events
	const eventsArray = tableField(snapshot, 'events') as Table;
	if (eventsArray instanceof Table) {
		const events = tableArrayToList(eventsArray);
		// Sort events by name
		const eventEntries: Array<{ name: string; table: Table }> = [];
		for (let i = 0; i < events.length; i++) {
			const ev = events[i] as Table;
			if (!(ev instanceof Table)) continue;
			const name = valueToString(tableField(ev, 'name'));
			eventEntries.push({ name, table: ev });
		}
		eventEntries.sort((a, b) => a.name.localeCompare(b.name));

		for (let i = 0; i < eventEntries.length; i++) {
			const { name, table: ev } = eventEntries[i];
			const listenersArray = tableField(ev, 'listeners') as Table;
			const listeners = listenersArray instanceof Table ? tableArrayToList(listenersArray) : [];
			const count = listeners.length;
			const nodeId = `ev:${name}`;
			const expandable = count > 0;
			const expanded = expandable && expandedIds.has(nodeId);
			const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';

			items.push({
				line: `${marker}${name} (${count})`,
				contentStartColumn: marker.length,
				descriptor: null,
				callHierarchyNodeId: nodeId,
				callHierarchyExpandable: expandable,
				callHierarchyExpanded: expanded,
			});

			if (!expanded) continue;

			for (let li = 0; li < listeners.length; li++) {
				const listener = listeners[li] as Table;
				if (!(listener instanceof Table)) continue;
				const subscriberId = valueToString(tableField(listener, 'subscriber_id'));
				const emitterId = tableField(listener, 'emitter_id');
				const persistent = tableField(listener, 'persistent');
				const parts: string[] = [];
				if (subscriberId !== 'nil') parts.push(`sub=${subscriberId}`);
				if (emitterId !== null) parts.push(`emit=${valueToString(emitterId)}`);
				if (persistent === true) parts.push('persistent');
				const detail = parts.length > 0 ? ` [${parts.join(', ')}]` : '';
				items.push({
					line: `${INDENT}  listener ${li + 1}${detail}`,
					contentStartColumn: INDENT.length + 2,
					descriptor: null,
				});
			}
		}
	}

	// Wildcard listeners
	const anyCount = tableField(snapshot, 'any_count');
	if (typeof anyCount === 'number' && anyCount > 0) {
		const anyNodeId = 'ev:*';
		const anyExpanded = expandedIds.has(anyNodeId);
		const anyMarker = anyExpanded ? '- ' : '+ ';

		items.push({
			line: `${anyMarker}* (wildcard) (${anyCount})`,
			contentStartColumn: anyMarker.length,
			descriptor: null,
			callHierarchyNodeId: anyNodeId,
			callHierarchyExpandable: true,
			callHierarchyExpanded: anyExpanded,
		});

		if (anyExpanded) {
			const anyArray = tableField(snapshot, 'any_listeners') as Table;
			if (anyArray instanceof Table) {
				const anyList = tableArrayToList(anyArray);
				for (let ai = 0; ai < anyList.length; ai++) {
					const entry = anyList[ai] as Table;
					if (!(entry instanceof Table)) continue;
					const persistent = tableField(entry, 'persistent');
					const tag = persistent === true ? ' [persistent]' : '';
					items.push({
						line: `${INDENT}  listener ${ai + 1}${tag}`,
						contentStartColumn: INDENT.length + 2,
						descriptor: null,
					});
				}
			}
		}
	}

	if (items.length === 0) {
		items.push({ line: '<no event listeners>', contentStartColumn: 0, descriptor: null });
	}

	return items;
}
