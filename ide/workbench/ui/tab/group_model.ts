import { resourceIdentityEquals } from '../../../common/resource';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import type { HostErrorInput } from '../../contrib/host_error/editor_input';
import type { BuildLogInput } from '../../contrib/builds/editor_input';
import type { PlayEditorInput } from '../../contrib/play/editor_input';
import type {
	BehaviorLensTabId,
	CodeEditorTabId,
	EditorTabId,
	ResourceViewerTabId,
	ScenarioLabTabId,
	BuildLogTabId,
	PlayTabId,
} from './id';
import type {
	BehaviorLensInput,
	CodeEditorInput,
	EditorInput,
	ResourceViewerInput,
	ScenarioLabInput,
} from './model';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorInputSerializer, EditorInputSerializers, SerializedEditorGroup, SerializedEditorInput, PersistentEditorInput } from '../../services/editor/editor_serialization';

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
	private restoreRequest = 0;

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	private emitChanged(): void {
		this.revision += 1;
		for (const listener of this.changeListeners) listener();
	}

	public serialize(serializers: EditorInputSerializers, previous?: SerializedEditorGroup): SerializedEditorGroup {
		// A transient active view closes at reload: select its nearest persistent
		// left neighbour, or the first persistent input when it had none on the left.
		// Selection indices are produced in the persisted sequence, never clamped at restore.
		const inputs: SerializedEditorInput[] = [];
		let active: number | null = null, preview: number | null = null;
		let passedActive = false;
		for (const input of this.editorTabs) {
			if (input === this.activeEditor) passedActive = true;
			if (!input.serializable) continue;
			const index = inputs.length;
			const serializer: EditorInputSerializer<PersistentEditorInput> = serializers[input.kind];
			const value = serializer.serialize(input);
			const prior = previous?.inputs[index];
			inputs.push(prior !== undefined && prior.kind === input.kind && prior.value === value ? prior : { kind: input.kind, value });
			if (input === this.activeEditor || this.activeEditor?.serializable === false && (!passedActive || active === null)) active = index;
			if (input === this.previewEditor) preview = index;
		}
		if (previous !== undefined && active === previous.active && preview === previous.preview
			&& inputs.length === previous.inputs.length && inputs.every((input, index) => input === previous.inputs[index])) return previous;
		return { inputs, active, preview };
	}

	/** Reconstruct inputs without activating intermediate panes or recording navigation. */
	public async deserialize(data: SerializedEditorGroup, serializers: EditorInputSerializers, signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) return false;
		const request = ++this.restoreRequest, revision = this.revision;
		const candidates: EditorInput[] = [];
		let published = false;
		try {
			for (const entry of data.inputs) {
				candidates.push(await serializers[entry.kind].deserialize(entry.value));
				if (request !== this.restoreRequest || this.revision !== revision || signal?.aborted) return false;
			}
			const cleared = this.clear();
			if (request !== this.restoreRequest || this.revision !== cleared || signal?.aborted) return false;
			for (const input of candidates) { this.editorTabs.push(input); this.registerInputListeners(input); }
			this.activeEditor = data.active === null ? null : this.editorTabs[data.active];
			this.previewEditor = data.preview === null ? null : this.editorTabs[data.preview];
			this.updateLabels(); published = true;
			this.emitChanged();
			return request === this.restoreRequest && this.revision === cleared + 1 && !signal?.aborted;
		} finally {
			if (!published) for (const input of candidates) input.dispose();
		}
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

	public clear(): number {
		const revision = ++this.revision;
		const retired = this.editorTabs.splice(0);
		this.activeEditor = null;
		this.previewEditor = null;
		this.labels.clear();
		for (const listener of this.listeners.values()) listener.dispose();
		this.listeners.clear();
		for (const tab of retired) tab.dispose();
		for (const listener of this.changeListeners) listener();
		return revision;
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
		this.emitChanged();
		return tab;
	}

	private registerInputListeners(tab: EditorInput): void {
		const listeners = new DisposableStore();
		listeners.add({ dispose: tab.onDidChangeLabel(() => { this.updateLabels(); this.emitChanged(); }) });
		if (tab.onDidChangeDirty !== undefined) listeners.add({ dispose: tab.onDidChangeDirty(() => {
			if (this.previewEditor === tab && tab.isDirty()) this.pin(tab);
			else this.emitChanged();
		}) });
		this.listeners.set(tab, listeners);
	}

	public pin(tab: EditorInput): void {
		if (this.previewEditor !== tab) return;
		this.previewEditor = null;
		this.updateLabels();
		this.emitChanged();
	}

	/** Label work belongs to membership/metadata changes, not the render loop. */
	private updateLabels(): void {
		const counts = new Map<string, number>();
		for (const tab of this.editorTabs) counts.set(tab.title, (counts.get(tab.title) || 0) + 1);
		const shortDescriptions = new Map<string, Set<string>>();
		for (const tab of this.editorTabs) {
			if (counts.get(tab.title)! === 1) continue;
			let descriptions = shortDescriptions.get(tab.title);
			if (descriptions === undefined) {
				descriptions = new Set();
				shortDescriptions.set(tab.title, descriptions);
			}
			descriptions.add(tab.shortDescription);
		}
		for (const tab of this.editorTabs) {
			const descriptions = shortDescriptions.get(tab.title);
			// Escalate the whole duplicate-name group together; mixing short and full descriptions can create new collisions.
			const description = descriptions !== undefined && descriptions.size === counts.get(tab.title) && !descriptions.has('')
				? tab.shortDescription : tab.description;
			const label = counts.get(tab.title)! > 1 && description.length > 0 ? `${tab.title} - ${description}` : tab.title;
			this.labels.set(tab, tab === this.previewEditor ? `PREVIEW: ${label}` : label);
		}
	}

	public activate(tab: EditorInput): void {
		this.activeEditor = tab;
		this.emitChanged();
	}

	public findById(tabId: 'host-error'): HostErrorInput | undefined;
	public findById(tabId: BuildLogTabId): BuildLogInput | undefined;
	public findById(tabId: PlayTabId): PlayEditorInput | undefined;
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

	/** Match document identity independently of a contribution's view/input object. */
	public findByResourceEditor(identity: ResourceEditorIdentity): EditorInput | undefined {
		for (const input of this.editorTabs) {
			const candidate = input.toResourceEditor?.();
			if (candidate !== undefined && candidate.editorId === identity.editorId && resourceIdentityEquals(candidate.resource, identity.resource)) return input;
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
		this.emitChanged();
	}

	/** An admitted handoff publishes both final memberships before either group notifies observers. */
	public transferTo(destination: EditorTabGroupModel, input: EditorInput, coalesced?: EditorInput): EditorInput {
		const index = this.editorTabs.indexOf(input);
		this.listeners.get(input)!.dispose();
		this.listeners.delete(input);
		this.labels.delete(input);
		this.editorTabs.splice(index, 1);
		if (this.activeEditor === input) {
			const successor = this.editorTabs[index - 1] ?? this.editorTabs[index];
			this.activeEditor = successor === undefined ? null : successor;
		}
		if (this.previewEditor === input) this.previewEditor = null;
		const admitted = coalesced === undefined ? input : coalesced;
		if (coalesced === undefined) {
			destination.editorTabs.push(input);
			destination.registerInputListeners(input);
		}
		destination.activeEditor = admitted;
		if (destination.previewEditor === admitted) destination.previewEditor = null;
		this.updateLabels();
		destination.updateLabels();
		this.revision += 1;
		destination.revision += 1;
		for (const listener of this.changeListeners) listener();
		for (const listener of destination.changeListeners) listener();
		return admitted;
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
