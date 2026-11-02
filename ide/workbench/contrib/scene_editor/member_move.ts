import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry, SceneSourceObject } from './model';
import type { SceneReparentChoice, SceneReparentMode, SceneSpatialProjection } from './spatial_projection';

export type SceneMemberMovePlacement = {
	readonly destination: number;
	readonly reparent: SceneReparentChoice | undefined;
};
export type SceneMemberMovePlan = {
	readonly index: number;
	readonly placements: ReadonlyMap<SceneReparentMode, ReadonlyMap<SceneSourceObject | undefined, ReadonlyMap<SceneSourceEntry | undefined, SceneMemberMovePlacement>>>;
};

/** A captured source generation resolves sibling slots once. Pointer admission
 * reads these maps; only acceptance produces edits. A visual subtree need not
 * occupy contiguous fields in the authored flat objects list. */
export function createSceneMemberMovePlan(document: SceneSourceDocument, scene: SceneSourceDefinition,
	member: SceneSourceObject, projection: SceneSpatialProjection): SceneMemberMovePlan | undefined {
	const parents = projection.getSpatialParents(document, scene);
	if (!parents.has(member)) return;
	const parent = parents.get(member);
	const modes: readonly SceneReparentMode[] = ['keep_world', 'keep_local'];
	const choices = new Map<SceneReparentMode, Map<SceneSourceObject | undefined, SceneReparentChoice | undefined>>();
	const candidates = new Set<SceneSourceObject | undefined>([parent]);
	for (const mode of modes) {
		const admitted = new Map<SceneSourceObject | undefined, SceneReparentChoice | undefined>([[parent, undefined]]);
		for (const choice of projection.reparentChoices(document, scene, member, mode)) { admitted.set(choice.parent, choice); candidates.add(choice.parent); }
		choices.set(mode, admitted);
	}
	const indices = new Map<typeof member.field, number>();
	for (let index = 0; index < scene.objectsTable.fields.length; index++) indices.set(scene.objectsTable.fields[index], index);
	const index = indices.get(member.field)!;
	const nextSibling = projection.sibling(document, scene, member, 1);
	const siblings = new Map<SceneSourceObject | undefined, SceneSourceObject[]>();
	const lastSibling = new Map<SceneSourceObject | undefined, SceneSourceEntry>();
	const entriesByField = new Map<typeof member.field, SceneSourceEntry>();
	for (const candidate of candidates) siblings.set(candidate, []);
	for (const entry of scene.objects) {
		entriesByField.set(entry.field, entry);
		if (entry.kind !== 'object' || !parents.has(entry)) { lastSibling.set(undefined, entry); continue; }
		const candidate = parents.get(entry);
		lastSibling.set(candidate, entry);
		if (candidate !== parent) siblings.get(candidate)?.push(entry);
	}
	// Same-parent order can cross known other-parent fields, but never a dynamic,
	// keyed or unresolved source barrier. The spatial producer owns that chain.
	let first = member, previous = projection.sibling(document, scene, first, -1);
	while (previous !== undefined) { first = previous; previous = projection.sibling(document, scene, first, -1); }
	let current: SceneSourceObject | undefined = first, lastInChain = member;
	while (current !== undefined) {
		if (current !== member) siblings.get(parent)!.push(current);
		lastInChain = current;
		current = projection.sibling(document, scene, current, 1);
	}
	const placements = new Map<SceneReparentMode, ReadonlyMap<SceneSourceObject | undefined, ReadonlyMap<SceneSourceEntry | undefined, SceneMemberMovePlacement>>>();
	for (const mode of modes) {
		const admitted = choices.get(mode)!, byParent = new Map<SceneSourceObject | undefined, ReadonlyMap<SceneSourceEntry | undefined, SceneMemberMovePlacement>>();
		for (const [candidate, entries] of siblings) {
			if (!admitted.has(candidate)) continue;
			const reparent = admitted.get(candidate), slots = new Map<SceneSourceEntry | undefined, SceneMemberMovePlacement>();
			for (const entry of entries) {
				if (candidate === parent && entry === nextSibling) continue;
				const before = indices.get(entry.field)!;
				const destination = before - (index < before ? 1 : 0);
				if (destination !== index || reparent !== undefined) slots.set(entry, { destination, reparent });
			}
			const last = entries[entries.length - 1];
			const after = last === undefined ? candidate === undefined ? scene.objectsTable.fields.length : indices.get(candidate.field)! + 1
				: indices.get(last.field)! + 1;
			const destination = after - (index < after ? 1 : 0);
			if ((candidate !== parent || nextSibling !== undefined && lastSibling.get(parent) === lastInChain)
				&& (destination !== index || reparent !== undefined))
				slots.set(undefined, { destination, reparent });
			// Root's next visible row may be an unproved composition. Its source start
			// is a safe end boundary for this chain, not permission to cross that row.
			if (candidate === undefined && candidate === parent && nextSibling !== undefined) {
				for (let rank = indices.get(lastInChain.field)! + 1; rank < scene.objectsTable.fields.length; rank++) {
					const boundary = entriesByField.get(scene.objectsTable.fields[rank]);
					if (boundary?.kind === 'object' && parents.has(boundary)) continue;
					if (boundary !== undefined) slots.set(boundary, { destination: rank - 1, reparent });
					break;
				}
			}
			if (slots.size > 0) byParent.set(candidate, slots);
		}
		if (byParent.size > 0) placements.set(mode, byParent);
	}
	return placements.size === 0 ? undefined : { index, placements };
}
