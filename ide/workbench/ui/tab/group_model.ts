import type {
	BehaviorLensTabId,
	CodeEditorTabId,
	EditorTabId,
	ResourceViewerTabId,
	ScenarioLabTabId,
} from './id';
import type {
	BehaviorLensInput,
	CodeEditorInput,
	EditorInput,
	ResourceViewerInput,
	ScenarioLabInput,
} from './model';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorInputSerializer, EditorInputSerializers, SerializedEditorGroup } from '../../services/editor/editor_serialization';

export type EditorOpenOptions = { readonly pinned?: boolean };

/**
 * Ordered editor inputs and their active selection. The active input is
 * retained directly, matching the editor-group model used by mature IDEs.
 */
export class EditorTabGroupModel {
	public revision = 0;
	private readonly editorTabs: EditorInput[] = [];
	private activeEditor: EditorInput | null = null;
	private previewEditor: EditorInput | null = null;
	private readonly listeners = new Map<EditorInput, DisposableStore>();
	private readonly labels = new Map<EditorInput, string>();
	private readonly changeListeners = new Set<() => void>();

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private emitChanged(): void {
		this.revision += 1;
		for (const listener of this.changeListeners) listener();
	}

	public serialize(serializers: EditorInputSerializers, previous?: SerializedEditorGroup): SerializedEditorGroup {
		const inputs = this.editorTabs.map((input, index) => {
			const serializer: EditorInputSerializer<EditorInput> = serializers[input.kind];
			const value = serializer.serialize(input);
			const prior = previous?.inputs[index];
			return prior !== undefined && prior.kind === input.kind && prior.value === value ? prior : { kind: input.kind, value };
		});
		const active = this.activeEditor === null ? null : this.indexOf(this.activeEditor);
		const preview = this.previewEditor === null ? null : this.indexOf(this.previewEditor);
		if (previous !== undefined && active === previous.active && preview === previous.preview
			&& inputs.length === previous.inputs.length && inputs.every((input, index) => input === previous.inputs[index])) return previous;
		return { inputs, active, preview };
	}

	/** Reconstruct inputs without activating intermediate panes or recording navigation. */
	public async deserialize(data: SerializedEditorGroup, serializers: EditorInputSerializers): Promise<void> {
		this.clear();
		for (const entry of data.inputs) {
			const input = await serializers[entry.kind].deserialize(entry.value);
			this.editorTabs.push(input);
			this.registerInputListeners(input);
		}
		this.activeEditor = data.active === null ? null : this.editorTabs[data.active];
		this.previewEditor = data.preview === null ? null : this.editorTabs[data.preview];
		this.updateLabels();
	}

	public get previewTab(): EditorInput | null { return this.previewEditor; }
	public getLabel(tab: EditorInput): string { return this.labels.get(tab)!; }

	public get tabs(): readonly EditorInput[] {
		return this.editorTabs;
	}

	public get activeTab(): EditorInput | null {
		return this.activeEditor;
	}

	public initialize(initialTab: EditorInput): void {
		this.clear();
		this.add(initialTab);
		this.activate(initialTab);
	}

	public clear(): void {
		for (const listener of this.listeners.values()) listener.dispose();
		this.listeners.clear();
		for (const tab of this.editorTabs) tab.dispose();
		this.editorTabs.length = 0;
		this.activeEditor = null;
		this.previewEditor = null;
		this.labels.clear();
		this.emitChanged();
	}

	/** The workbench detaches a replaced pane before changing group membership. */
	public add(tab: EditorInput, options: EditorOpenOptions = {}): EditorInput {
		const existing = this.findById(tab.id);
		if (existing !== undefined) {
			// Concurrent resolvers may offer two inputs for the same resource view.
			// Admission owns the candidate; the group keeps its existing view alive.
			if (tab !== existing) tab.dispose();
			if (options.pinned !== false) this.pin(existing);
			return existing;
		}
		const preview = options.pinned === false && tab.closable && !tab.isDirty();
		let index = this.editorTabs.length;
		if (preview && this.previewEditor !== null) {
			index = this.indexOf(this.previewEditor);
			this.removeAt(index);
		}
		this.editorTabs.splice(index, 0, tab);
		if (preview) this.previewEditor = tab;
		this.registerInputListeners(tab);
		this.updateLabels();
		return tab;
	}

	private registerInputListeners(tab: EditorInput): void {
		const listeners = new DisposableStore();
		listeners.add({ dispose: tab.onDidChangeLabel(() => this.updateLabels()) });
		if (tab.onDidChangeDirty !== undefined) listeners.add({ dispose: tab.onDidChangeDirty(() => {
			if (tab.isDirty()) this.pin(tab);
		}) });
		this.listeners.set(tab, listeners);
	}

	public pin(tab: EditorInput): void {
		if (this.previewEditor !== tab) return;
		this.previewEditor = null;
		this.updateLabels();
	}

	/** Label work belongs to membership/metadata changes, not the render loop. */
	private updateLabels(): void {
		const counts = new Map<string, number>();
		for (const tab of this.editorTabs) counts.set(tab.title, (counts.get(tab.title) || 0) + 1);
		for (const tab of this.editorTabs) {
			const label = counts.get(tab.title)! > 1 && tab.description.length > 0 ? `${tab.title} - ${tab.description}` : tab.title;
			this.labels.set(tab, tab === this.previewEditor ? `PREVIEW: ${label}` : label);
		}
		this.emitChanged();
	}

	public activate(tab: EditorInput): void {
		this.activeEditor = tab;
		this.emitChanged();
	}

	public findById(tabId: CodeEditorTabId): CodeEditorInput | undefined;
	public findById(tabId: ResourceViewerTabId): ResourceViewerInput | undefined;
	public findById(tabId: BehaviorLensTabId): BehaviorLensInput | undefined;
	public findById(tabId: ScenarioLabTabId): ScenarioLabInput | undefined;
	public findById(tabId: EditorTabId): EditorInput | undefined;
	public findById(tabId: EditorTabId): EditorInput | undefined {
		for (let index = 0; index < this.editorTabs.length; index += 1) {
			const tab = this.editorTabs[index];
			if (tab.id === tabId) {
				return tab;
			}
		}
		return undefined;
	}

	public indexOf(tab: EditorInput): number {
		return this.editorTabs.indexOf(tab);
	}

	public removeAt(index: number): void {
		const removed = this.editorTabs[index];
		this.listeners.get(removed)!.dispose();
		this.listeners.delete(removed);
		this.labels.delete(removed);
		this.editorTabs.splice(index, 1);
		if (this.activeEditor === removed) {
			this.activeEditor = null;
		}
		if (this.previewEditor === removed) this.previewEditor = null;
		removed.dispose();
		this.updateLabels();
	}

	public move(fromIndex: number, toIndex: number): void {
		const tab = this.editorTabs[fromIndex];
		if (fromIndex < toIndex) {
			for (let index = fromIndex; index < toIndex; index += 1) {
				this.editorTabs[index] = this.editorTabs[index + 1];
			}
		} else {
			for (let index = fromIndex; index > toIndex; index -= 1) {
				this.editorTabs[index] = this.editorTabs[index - 1];
			}
		}
		this.editorTabs[toIndex] = tab;
		this.emitChanged();
	}
}

export const editorTabGroup = new EditorTabGroupModel();
