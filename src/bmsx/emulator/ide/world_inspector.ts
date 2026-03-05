import { Table, type Value } from '../cpu';
import { Runtime } from '../runtime';
import { runConsoleChunk } from '../runtime_lua_pipeline';
import { valueToString } from '../lua_globals';
import { isStringValue, stringValueToString } from '../string_pool';
import type { ResourceBrowserItem } from './types';

const INDENT = '  ';

// Lua snippet that traverses the world and returns a structured result table.
// Uses normal Lua semantics (ipairs, field access) so __index etc. work correctly.
const WORLD_SNAPSHOT_LUA = `
local w = require('world').instance
local r = {}
r.active_space_id = w.active_space_id
r.spaces = {}
for i, sid in ipairs(w._space_order) do
	local sp = w._spaces[sid]
	local si = { id = sid, objects = {} }
	for j, obj in ipairs(sp.objects) do
		local oi = {
			id = obj.id, type_name = obj.type_name,
			x = obj.x, y = obj.y, z = obj.z,
			active = obj.active, tick_enabled = obj.tick_enabled,
			player_index = obj.player_index, dispose_flag = obj.dispose_flag,
			visible = obj.visible, space_id = obj.space_id,
		}
		if obj.sc and obj.sc.current_state then
			oi.fsm_state = obj.sc.current_state
		end
		if obj.tags then
			local tl = {}
			for k, v in pairs(obj.tags) do
				if v == true then tl[#tl + 1] = k end
			end
			if #tl > 0 then oi.tag_list = tl end
		end
		if obj.components and #obj.components > 0 then
			local cl = {}
			for ci = 1, #obj.components do
				local c = obj.components[ci]
				cl[ci] = { type_name = c.type_name, id_local = c.id_local }
			end
			oi.comp_list = cl
		end
		local extras = {}
		local known = {
			id=1, type_name=1, x=1, y=1, z=1, sx=1, sy=1, sz=1,
			active=1, tick_enabled=1, fsm_dispatch_enabled=1, player_index=1,
			tags=1, components=1, component_map=1, space_id=1, dispose_flag=1,
			events=1, sc=1, timelines=1, btreecontexts=1, visible=1,
		}
		for k, v in pairs(obj) do
			if not known[k] and type(k) == "string" then
				extras[#extras + 1] = { k = k, v = tostring(v) }
			end
		end
		if #extras > 0 then oi.extras = extras end
		si.objects[j] = oi
	end
	r.spaces[i] = si
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

export function buildWorldInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const runtime = Runtime.instance;
	const results = runConsoleChunk(runtime, WORLD_SNAPSHOT_LUA);
	const snapshot = results.length > 0 ? results[0] : null;
	if (!(snapshot instanceof Table)) {
		return [{ line: '<world not available>', contentStartColumn: 0, descriptor: null }];
	}

	const activeSpaceId = valueToString(tableField(snapshot, 'active_space_id'));
	const spacesArray = tableField(snapshot, 'spaces') as Table;
	if (!(spacesArray instanceof Table)) {
		return [{ line: '<no spaces>', contentStartColumn: 0, descriptor: null }];
	}

	const spaces = tableArrayToList(spacesArray);
	const items: ResourceBrowserItem[] = [];

	for (let si = 0; si < spaces.length; si++) {
		const spaceInfo = spaces[si] as Table;
		if (!(spaceInfo instanceof Table)) continue;
		const spaceId = valueToString(tableField(spaceInfo, 'id'));
		const objectsArray = tableField(spaceInfo, 'objects') as Table;
		const objects = objectsArray instanceof Table ? tableArrayToList(objectsArray) : [];
		const objectCount = objects.length;
		const spaceNodeId = `s:${spaceId}`;
		const expandable = objectCount > 0;
		const expanded = expandable && expandedIds.has(spaceNodeId);
		const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';
		const activeTag = spaceId === activeSpaceId ? ' *' : '';

		items.push({
			line: `${marker}${spaceId}${activeTag} (${objectCount})`,
			contentStartColumn: marker.length,
			descriptor: null,
			callHierarchyNodeId: spaceNodeId,
			callHierarchyExpandable: expandable,
			callHierarchyExpanded: expanded,
		});

		if (!expanded) continue;

		for (let oi = 0; oi < objects.length; oi++) {
			const obj = objects[oi] as Table;
			if (!(obj instanceof Table)) continue;

			const objId = valueToString(tableField(obj, 'id'));
			const typeName = valueToString(tableField(obj, 'type_name'));
			const active = tableField(obj, 'active');
			const objNodeId = `o:${spaceId}:${objId}`;
			const objExpanded = expandedIds.has(objNodeId);
			const objMarker = objExpanded ? '- ' : '+ ';
			const activeStr = active === false ? ' [inactive]' : '';

			items.push({
				line: `${INDENT}${objMarker}${objId} (${typeName})${activeStr}`,
				contentStartColumn: INDENT.length + objMarker.length,
				descriptor: null,
				callHierarchyNodeId: objNodeId,
				callHierarchyExpandable: true,
				callHierarchyExpanded: objExpanded,
			});

			if (!objExpanded) continue;

			const propIndent = INDENT.repeat(2);
			const addProp = (label: string, value: string): void => {
				items.push({
					line: `${propIndent}  ${label}: ${value}`,
					contentStartColumn: propIndent.length + 2,
					descriptor: null,
				});
			};

			addProp('pos', `(${valueToString(tableField(obj, 'x'))}, ${valueToString(tableField(obj, 'y'))}, ${valueToString(tableField(obj, 'z'))})`);
			addProp('active', valueToString(active));
			addProp('tick', valueToString(tableField(obj, 'tick_enabled')));

			const playerIndex = tableField(obj, 'player_index');
			if (playerIndex !== null) addProp('player', valueToString(playerIndex));

			const disposeFlag = tableField(obj, 'dispose_flag');
			if (disposeFlag === true) addProp('dispose_flag', 'true');

			// FSM state
			const fsmState = tableField(obj, 'fsm_state');
			if (fsmState !== null) addProp('state', valueToString(fsmState));

			// Tags
			const tagList = tableField(obj, 'tag_list') as Table;
			if (tagList instanceof Table) {
				const tags = tableArrayToList(tagList).map(valueToString);
				if (tags.length > 0) addProp('tags', tags.join(', '));
			}

			// Components
			const compList = tableField(obj, 'comp_list') as Table;
			if (compList instanceof Table) {
				const comps = tableArrayToList(compList);
				if (comps.length > 0) {
					const compNodeId = `c:${spaceId}:${objId}`;
					const compExpanded = expandedIds.has(compNodeId);
					const compMarker = compExpanded ? '- ' : '+ ';

					items.push({
						line: `${propIndent}  ${compMarker}components (${comps.length})`,
						contentStartColumn: propIndent.length + 2 + compMarker.length,
						descriptor: null,
						callHierarchyNodeId: compNodeId,
						callHierarchyExpandable: true,
						callHierarchyExpanded: compExpanded,
					});

					if (compExpanded) {
						const compBodyIndent = INDENT.repeat(3) + '  ';
						for (let ci = 0; ci < comps.length; ci++) {
							const comp = comps[ci] as Table;
							if (!(comp instanceof Table)) continue;
							const compType = valueToString(tableField(comp, 'type_name'));
							const compLocalId = tableField(comp, 'id_local');
							const localIdStr = compLocalId !== null ? ` (${valueToString(compLocalId)})` : '';
							items.push({
								line: `${compBodyIndent}${compType}${localIdStr}`,
								contentStartColumn: compBodyIndent.length,
								descriptor: null,
							});
						}
					}
				}
			}

			// Extra fields
			const extras = tableField(obj, 'extras') as Table;
			if (extras instanceof Table) {
				const extraEntries = tableArrayToList(extras);
				if (extraEntries.length > 0) {
					const extrasNodeId = `x:${spaceId}:${objId}`;
					const extrasExpanded = expandedIds.has(extrasNodeId);
					const extrasMarker = extrasExpanded ? '- ' : '+ ';

					items.push({
						line: `${propIndent}  ${extrasMarker}fields (${extraEntries.length})`,
						contentStartColumn: propIndent.length + 2 + extrasMarker.length,
						descriptor: null,
						callHierarchyNodeId: extrasNodeId,
						callHierarchyExpandable: true,
						callHierarchyExpanded: extrasExpanded,
					});

					if (extrasExpanded) {
						const extraIndent = INDENT.repeat(3) + '  ';
						for (let ei = 0; ei < extraEntries.length; ei++) {
							const entry = extraEntries[ei] as Table;
							if (!(entry instanceof Table)) continue;
							const fieldName = valueToString(tableField(entry, 'k'));
							const fieldValue = valueToString(tableField(entry, 'v'));
							items.push({
								line: `${extraIndent}${fieldName}: ${fieldValue}`,
								contentStartColumn: extraIndent.length,
								descriptor: null,
							});
						}
					}
				}
			}
		}
	}

	if (items.length === 0) {
		items.push({ line: '<no world objects>', contentStartColumn: 0, descriptor: null });
	}
	return items;
}
