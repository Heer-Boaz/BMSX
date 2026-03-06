import { Table } from '../cpu';
import { valueToString } from '../lua_globals';
import {
	appendInspectorLeaf,
	appendInspectorNode,
	runInspectorSnapshot,
	tableArrayToList,
	tableField,
	tableFieldString,
} from './inspector_utils';
import type { ResourceBrowserItem } from './types';

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

export function buildEventInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const snapshot = runInspectorSnapshot(EVENT_SNAPSHOT_LUA);
	if (snapshot === null) {
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
			const expanded = appendInspectorNode(items, expandedIds, 0, `${name} (${count})`, nodeId, count > 0);

			if (!expanded) continue;

			for (let li = 0; li < listeners.length; li++) {
				const listener = listeners[li] as Table;
				if (!(listener instanceof Table)) continue;
				const subscriberId = tableFieldString(listener, 'subscriber_id');
				const emitterId = tableFieldString(listener, 'emitter_id');
				const persistent = tableField(listener, 'persistent');
				const parts: string[] = [];
				if (subscriberId !== null) parts.push(`sub=${subscriberId}`);
				if (emitterId !== null) parts.push(`emit=${emitterId}`);
				if (persistent === true) parts.push('persistent');
				const detail = parts.length > 0 ? ` [${parts.join(', ')}]` : '';
				appendInspectorLeaf(items, 1, `listener ${li + 1}${detail}`, '  ');
			}
		}
	}

	// Wildcard listeners
	const anyCount = tableField(snapshot, 'any_count');
	if (typeof anyCount === 'number' && anyCount > 0) {
		const anyNodeId = 'ev:*';
		const anyExpanded = appendInspectorNode(items, expandedIds, 0, `* (wildcard) (${anyCount})`, anyNodeId, true);

		if (anyExpanded) {
			const anyArray = tableField(snapshot, 'any_listeners') as Table;
			if (anyArray instanceof Table) {
				const anyList = tableArrayToList(anyArray);
				for (let ai = 0; ai < anyList.length; ai++) {
					const entry = anyList[ai] as Table;
					if (!(entry instanceof Table)) continue;
					const persistent = tableField(entry, 'persistent');
					const tag = persistent === true ? ' [persistent]' : '';
					appendInspectorLeaf(items, 1, `listener ${ai + 1}${tag}`, '  ');
				}
			}
		}
	}

	if (items.length === 0) {
		items.push({ line: '<no event listeners>', contentStartColumn: 0, descriptor: null });
	}

	return items;
}
