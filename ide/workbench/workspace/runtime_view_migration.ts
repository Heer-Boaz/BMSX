import type { SerializedEditorGroup, SerializedEditorInput } from '../services/editor/editor_serialization';
import type { SerializedEditorGroupLayout, SerializedEditorParts } from '../services/editor/editor_parts_serialization';
import type { WorkspaceAutosavePayload } from './models';

type StoredInput = SerializedEditorInput | { readonly kind: 'game_view'; readonly value: string };
type StoredGroup = Omit<SerializedEditorGroup, 'inputs'> & { readonly inputs: readonly StoredInput[] };
type StoredLayout = { readonly kind: 'group'; readonly group: StoredGroup }
	| Omit<Extract<SerializedEditorGroupLayout, { kind: 'split' }>, 'first' | 'second'> & { readonly first: StoredLayout; readonly second: StoredLayout };
type StoredPart = Omit<SerializedEditorParts['main'], 'layout'> & { readonly layout: StoredLayout };
type StoredPayload = Omit<WorkspaceAutosavePayload, 'editorParts'> & { readonly editorParts: Omit<SerializedEditorParts, 'main' | 'documents'> & {
	readonly main: StoredPart;
	readonly documents: readonly (StoredPart & Omit<SerializedEditorParts['documents'][number], keyof StoredPart>)[];
} };

/** The retired display-only Game tabs and Actor Lab now identify one runtime
 * workspace. Migrate saved membership, not live inputs or guest state. */
export function migrateRuntimeViews(payload: StoredPayload): WorkspaceAutosavePayload {
	const parts = [payload.editorParts.main, ...payload.editorParts.documents];
	let winner: StoredInput | undefined, legacy = false;
	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex], leaves: StoredGroup[] = [];
		const collect = (node: StoredLayout): void => {
			if (node.kind === 'group') leaves.push(node.group);
			else { collect(node.first); collect(node.second); }
		};
		collect(part.layout);
		for (let groupIndex = 0; groupIndex < leaves.length; groupIndex++) {
			const group = leaves[groupIndex];
			for (let index = 0; index < group.inputs.length; index++) {
				const entry = group.inputs[index];
				if (entry.kind !== 'game_view' && entry.kind !== 'actor_lab') continue;
				legacy ||= entry.kind === 'game_view';
				if (winner === undefined || payload.editorParts.active === partIndex && part.active === groupIndex && group.active === index) winner = entry;
			}
		}
	}
	if (!legacy) return payload as WorkspaceAutosavePayload;
	let companion = payload.sceneCompanion;
	const migrated = parts.map((part, partIndex) => {
		let groupIndex = 0;
		const visit = (node: StoredLayout): SerializedEditorGroupLayout => {
			if (node.kind === 'split') return { ...node, first: visit(node.first), second: visit(node.second) };
			const group = node.group, inputs: SerializedEditorInput[] = [], indices: number[] = [];
			for (const entry of group.inputs) {
				const runtime = entry.kind === 'game_view' || entry.kind === 'actor_lab';
				indices.push(runtime && entry !== winner ? -1 : inputs.length);
				if (runtime) { if (entry === winner) inputs.push({ kind: 'actor_lab', value: '' }); }
				else inputs.push(entry);
			}
			if (companion?.part === partIndex && companion.group === groupIndex) {
				const input = indices[companion.input];
				companion = input === -1 ? undefined : { ...companion, input };
			}
			groupIndex++;
			const active = group.active === null ? null : indices[group.active];
			const preview = group.preview === null ? null : indices[group.preview];
			return { kind: 'group', group: { inputs, active: active === -1 ? inputs.length === 0 ? null : 0 : active,
				preview: preview === -1 ? null : preview } };
		};
		return { ...part, layout: visit(part.layout) };
	});
	return { ...payload, sceneCompanion: companion, editorParts: { ...payload.editorParts, main: migrated[0],
		documents: payload.editorParts.documents.map((part, index) => ({ ...part, ...migrated[index + 1] })) } };
}
