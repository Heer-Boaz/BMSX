import type { InputFocusTarget } from '../../../input/focus';
import type { DisposableStore } from '../../../common/lifecycle';
import type { EditorParts, EditorMoveDestination } from './editor_parts';
import type { EditorGroupView } from './editor_group';
import type { QuickInputController } from '../quick_input/controller';
import type { EditorTabDragSource } from '../../ui/tab/drag';
import { TextQuickPickProvider } from '../quick_input/text_provider';

type MoveTarget = { readonly kind: 'group'; readonly group: EditorGroupView } | { readonly kind: 'window' };
type TargetItem = { readonly target: MoveTarget; label: string; description: string; detail: string };
type PlacementItem = { readonly destination: EditorMoveDestination; label: string; description: string; detail: string };
const DIRECTIONS = [
	{ direction: 'left', label: 'Split Left' }, { direction: 'right', label: 'Split Right' },
	{ direction: 'up', label: 'Split Above' }, { direction: 'down', label: 'Split Below' },
] as const;

/** Both transfer gestures and commands retain the exact source and destination owners. */
export function showMoveDestination(parts: EditorParts, picker: QuickInputController,
	source: EditorTabDragSource, origin: InputFocusTarget | null): void {
	const group = parts.groupForModel(source.model)!;
	const title = source.kind === 'editor' ? 'MOVE EDITOR' : 'MOVE GROUP';
	const current = () => parts.groupForModel(source.model) === group && (source.kind === 'group' || source.model.contains(source.input));
	const observeSource = (lifetime: DisposableStore) => {
		lifetime.add({ dispose: group.onWillDispose(() => picker.hide(false)) });
		if (source.kind === 'editor') {
			lifetime.add({ dispose: source.input.onWillDispose(() => picker.hide(false)) });
			lifetime.add({ dispose: source.model.onDidChange(change => {
				if (change === 'editors' && !source.model.contains(source.input)) picker.hide(false);
			}) });
		}
	};
	const showTargets = () => {
		if (!current()) return;
		picker.pick(title, 'Choose a group or window', (_origin, lifetime) => {
			const items: TargetItem[] = [];
			for (const part of parts.mostRecentlyActive) for (const target of part.mostRecentlyActiveGroups) {
				const destination: EditorMoveDestination = { kind: 'group', group: target };
				let eligible = source.kind === 'editor' ? parts.canMoveEditor(group, source.input, destination) : parts.canMoveGroup(group, destination);
				if (!eligible) for (const { direction } of DIRECTIONS) {
					const split: EditorMoveDestination = { kind: 'split', group: target, direction };
					eligible = source.kind === 'editor' ? parts.canMoveEditor(group, source.input, split) : parts.canMoveGroup(group, split);
					if (eligible) break;
				}
				if (!eligible) continue;
				if (target !== group) lifetime.add({ dispose: target.onWillDispose(() => picker.hide(false)) });
				const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
				items.push({ target: { kind: 'group', group: target },
					label: part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(target) + 1}`,
					description: target.model.activeTab?.description ?? '', detail: part.window?.model.minimized ? 'Minimized editor window' : '' });
			}
			const window: EditorMoveDestination = { kind: 'window' };
			if (source.kind === 'editor' ? parts.canMoveEditor(group, source.input, window) : parts.canMoveGroup(group, window))
				items.push({ target: { kind: 'window' }, label: 'New Editor Window', description: '', detail: '' });
			return new TextQuickPickProvider(items);
		}, (item, _modifiers, preserveFocus) => {
			if (preserveFocus || !current()) return;
			if (item.target.kind === 'group') showPlacements(item.target.group);
			else if (source.kind === 'editor') parts.moveEditor(group, source.input, item.target);
			else parts.moveGroup(group, item.target);
		}, observeSource, { invocationOrigin: origin, step: { index: 1, total: 2 } });
	};
	const showPlacements = (target: EditorGroupView) => {
		if (!current() || parts.groupForModel(target.model) !== target) return;
		const part = parts.partForGroup(target);
		const host = part.kind === 'main' ? 'Main Workspace' : part.window!.model.title;
		const targetLabel = part.groups.length === 1 ? host : `${host} / Group ${part.groups.indexOf(target) + 1}`;
		picker.pick(title, `Placement in ${targetLabel}`, () => {
			const items: PlacementItem[] = [], destination: EditorMoveDestination = { kind: 'group', group: target };
			if (source.kind === 'editor' ? parts.canMoveEditor(group, source.input, destination) : parts.canMoveGroup(group, destination))
				items.push({ destination, label: source.kind === 'editor' ? 'Into Group' : 'Merge Groups', description: '', detail: '' });
			for (const { direction, label } of DIRECTIONS) {
				const destination: EditorMoveDestination = { kind: 'split', group: target, direction };
				if (source.kind === 'editor' ? parts.canMoveEditor(group, source.input, destination) : parts.canMoveGroup(group, destination))
					items.push({ destination, label, description: '', detail: '' });
			}
			if (items.length === 0) picker.hide();
			return new TextQuickPickProvider(items);
		}, (item, _modifiers, preserveFocus) => {
			if (preserveFocus || !current()) return;
			if (source.kind === 'editor') parts.moveEditor(group, source.input, item.destination);
			else parts.moveGroup(group, item.destination);
		}, lifetime => {
			observeSource(lifetime);
			if (target !== group) lifetime.add({ dispose: target.onWillDispose(() => picker.hide(false)) });
		}, { invocationOrigin: origin, step: { index: 2, total: 2, back: showTargets } });
	};
	showTargets();
}
