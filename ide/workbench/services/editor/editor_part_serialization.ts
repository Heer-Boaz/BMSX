import type { EditorPart } from './editor_part';
import type { EditorInputSerializers } from './editor_serialization';
import type { EditorGroupView } from './editor_group';
import type { EditorGroupNode } from './group_arrangement';
import type { SerializedEditorGroupLayout, SerializedEditorPart } from './editor_parts_serialization';

function serializeLayout(node: EditorGroupNode<EditorGroupView>, serializers: EditorInputSerializers,
	previous: SerializedEditorGroupLayout | undefined): SerializedEditorGroupLayout {
	if (node.kind === 'group') {
		const prior = previous?.kind === 'group' ? previous : undefined;
		const group = node.group.model.serialize(serializers, prior?.group);
		return prior !== undefined && prior.group === group ? prior : { kind: 'group', group };
	}
	const prior = previous?.kind === 'split' ? previous : undefined;
	const first = serializeLayout(node.first, serializers, prior?.first), second = serializeLayout(node.second, serializers, prior?.second);
	const { orientation, ratio } = node.split;
	return prior !== undefined && prior.orientation === orientation && prior.ratio === ratio && prior.first === first && prior.second === second
		? prior : { kind: 'split', orientation, ratio, first, second };
}

/** Persist the actual group topology and view owners; unchanged subtrees retain their mementos. */
export function serializeEditorPart(part: EditorPart, serializers: EditorInputSerializers, previous?: SerializedEditorPart): SerializedEditorPart {
	const layout = serializeLayout(part.arrangement.root, serializers, previous?.layout);
	const active = part.groups.indexOf(part.activeGroup);
	const arrangement = part.arrangement;
	let maximized: SerializedEditorPart['maximized'];
	if (arrangement.maximized !== undefined) {
		const group = part.groups.indexOf(arrangement.maximized), prior = previous?.maximized;
		maximized = prior !== undefined && prior.group === group && prior.scrollX === arrangement.scrollX && prior.scrollY === arrangement.scrollY
			? prior : { group, scrollX: arrangement.scrollX, scrollY: arrangement.scrollY };
	}
	const activeGroups = part.mostRecentlyActiveGroups;
	const sameOrder = previous !== undefined && activeGroups.length === previous.mru.length
		&& activeGroups.every((group, index) => part.groups.indexOf(group) === previous.mru[index]);
	const scrollX = arrangement.normalScrollX, scrollY = arrangement.normalScrollY;
	if (previous !== undefined && layout === previous.layout && active === previous.active && maximized === previous.maximized
		&& scrollX === previous.scrollX && scrollY === previous.scrollY
		&& sameOrder) return previous;
	const mru = sameOrder ? previous.mru : activeGroups.map(group => part.groups.indexOf(group));
	return { layout, active, mru, scrollX, scrollY, maximized };
}
