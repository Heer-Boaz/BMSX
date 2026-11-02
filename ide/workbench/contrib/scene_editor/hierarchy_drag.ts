import { KeyModifier } from '../../../../hosts/common/input/text';
import type { WorkbenchTreeDragSession } from '../../ui/tree_drag';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneSourceEntry, SceneSourceObject } from './model';
import type { SceneOutlineElement } from './outline';

/** Normalize the actual tree position to one authored parent and sibling boundary. */
export function beginSceneHierarchyDrag(view: SceneHierarchyViewState, source: WorkbenchTreeNode<SceneOutlineElement>,
	didMove: () => void): WorkbenchTreeDragSession<SceneOutlineElement> | undefined {
	const selected = view.authoring.selection;
	if (source.element.kind !== 'member' || selected?.kind !== 'member'
		|| selected.scene !== source.element.scene || selected.entry !== source.element.entry) return;
	const request = view.authoring.captureMemberMove();
	if (request === undefined || request.entry !== source.element.entry || request.scene !== source.element.scene) return;
	let parent: SceneSourceObject | undefined, before: SceneSourceEntry | undefined;
	return {
		label: source.element.displayLabel, labelWidth: measureText(source.element.displayLabel), font: editorViewState.font.renderFont(),
		isCurrent: request.isCurrent,
		canDrop: (target, placement, modifiers) => {
			const element = target.element;
			if (element.scene !== request.scene) return false;
			parent = undefined; before = undefined;
			if (placement === 'inside') {
				if (element.kind === 'member') {
					if (element.entry.kind !== 'object') return false;
					parent = element.entry;
				}
			} else {
				if (element.kind !== 'member') return false;
				const container = target.parent!.element;
				if (container.kind === 'member') {
					if (container.entry.kind !== 'object') return false;
					parent = container.entry;
				}
				if (placement === 'before') before = element.entry;
				else {
					const siblings = target.parent!.children, next = siblings[siblings.indexOf(target) + 1]?.element;
					if (next?.kind === 'scene') return false;
					before = next?.entry;
				}
			}
			return request.canPlace(parent, before, (modifiers & KeyModifier.alt) !== 0 ? 'keep_local' : 'keep_world');
		},
		drop: (_target, _placement, modifiers) => { if (request.apply(parent, before, (modifiers & KeyModifier.alt) !== 0 ? 'keep_local' : 'keep_world')) didMove(); },
	};
}
