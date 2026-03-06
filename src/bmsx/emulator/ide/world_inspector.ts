import { Table } from '../cpu';
import { valueToString } from '../lua_globals';
import {
	appendInspectorDetail,
	appendInspectorLeaf,
	appendInspectorNode,
	runInspectorSnapshot,
	tableArrayToList,
	tableField,
	tableFieldString,
} from './inspector_utils';
import type { ResourceBrowserItem } from './types';

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

export function buildWorldInspectorItems(expandedIds: Set<string>): ResourceBrowserItem[] {
	const snapshot = runInspectorSnapshot(WORLD_SNAPSHOT_LUA);
	if (snapshot === null) {
		return [{ line: '<world not available>', contentStartColumn: 0, descriptor: null }];
	}

	const activeSpaceId = tableFieldString(snapshot, 'active_space_id');
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
		const activeTag = spaceId === activeSpaceId ? ' *' : '';
		const expanded = appendInspectorNode(
			items,
			expandedIds,
			0,
			`${spaceId}${activeTag} (${objectCount})`,
			spaceNodeId,
			objectCount > 0,
		);

		if (!expanded) continue;

		for (let oi = 0; oi < objects.length; oi++) {
			const obj = objects[oi] as Table;
			if (!(obj instanceof Table)) continue;

			const objId = valueToString(tableField(obj, 'id'));
			const typeName = valueToString(tableField(obj, 'type_name'));
			const active = tableField(obj, 'active');
			const objNodeId = `o:${spaceId}:${objId}`;
			const activeStr = active === false ? ' [inactive]' : '';
			const objExpanded = appendInspectorNode(
				items,
				expandedIds,
				1,
				`${objId} (${typeName})${activeStr}`,
				objNodeId,
				true,
			);

			if (!objExpanded) continue;

			appendInspectorDetail(items, 2, 'pos', `(${valueToString(tableField(obj, 'x'))}, ${valueToString(tableField(obj, 'y'))}, ${valueToString(tableField(obj, 'z'))})`);
			appendInspectorDetail(items, 2, 'active', valueToString(active));
			appendInspectorDetail(items, 2, 'tick', valueToString(tableField(obj, 'tick_enabled')));

			const playerIndex = tableField(obj, 'player_index');
			if (playerIndex !== null) appendInspectorDetail(items, 2, 'player', valueToString(playerIndex));

			const disposeFlag = tableField(obj, 'dispose_flag');
			if (disposeFlag === true) appendInspectorDetail(items, 2, 'dispose_flag', 'true');

			const fsmState = tableField(obj, 'fsm_state');
			if (fsmState !== null) appendInspectorDetail(items, 2, 'state', valueToString(fsmState));

			const tagList = tableField(obj, 'tag_list') as Table;
			if (tagList instanceof Table) {
				const tags = tableArrayToList(tagList).map(valueToString);
				if (tags.length > 0) appendInspectorDetail(items, 2, 'tags', tags.join(', '));
			}

			const compList = tableField(obj, 'comp_list') as Table;
			if (compList instanceof Table) {
				const comps = tableArrayToList(compList);
				if (comps.length > 0) {
					const compNodeId = `c:${spaceId}:${objId}`;
					const compExpanded = appendInspectorNode(
						items,
						expandedIds,
						2,
						`components (${comps.length})`,
						compNodeId,
						true,
						'  ',
					);

					if (compExpanded) {
						for (let ci = 0; ci < comps.length; ci++) {
							const comp = comps[ci] as Table;
							if (!(comp instanceof Table)) continue;
							const compType = valueToString(tableField(comp, 'type_name'));
							const compLocalId = tableField(comp, 'id_local');
							const localIdStr = compLocalId !== null ? ` (${valueToString(compLocalId)})` : '';
							appendInspectorLeaf(items, 3, `${compType}${localIdStr}`, '  ');
						}
					}
				}
			}

			const extras = tableField(obj, 'extras') as Table;
			if (extras instanceof Table) {
				const extraEntries = tableArrayToList(extras);
				if (extraEntries.length > 0) {
					const extrasNodeId = `x:${spaceId}:${objId}`;
					const extrasExpanded = appendInspectorNode(
						items,
						expandedIds,
						2,
						`fields (${extraEntries.length})`,
						extrasNodeId,
						true,
						'  ',
					);

					if (extrasExpanded) {
						for (let ei = 0; ei < extraEntries.length; ei++) {
							const entry = extraEntries[ei] as Table;
							if (!(entry instanceof Table)) continue;
							const fieldName = valueToString(tableField(entry, 'k'));
							const fieldValue = valueToString(tableField(entry, 'v'));
							appendInspectorLeaf(items, 3, `${fieldName}: ${fieldValue}`, '  ');
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
