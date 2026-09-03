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

/**
 * Ordered editor inputs and their active selection. The active input is
 * retained directly, matching the editor-group model used by mature IDEs.
 */
export class EditorTabGroupModel {
	private readonly editorTabs: EditorInput[] = [];
	private activeEditor: EditorInput | null = null;

	public get tabs(): readonly EditorInput[] {
		return this.editorTabs;
	}

	public get activeTab(): EditorInput | null {
		return this.activeEditor;
	}

	public initialize(initialTab: EditorInput): void {
		this.clear();
		this.editorTabs.push(initialTab);
		this.activeEditor = initialTab;
	}

	public clear(): void {
		this.editorTabs.length = 0;
		this.activeEditor = null;
	}

	public add(tab: EditorInput): void {
		this.editorTabs.push(tab);
	}

	public activate(tab: EditorInput): void {
		this.activeEditor = tab;
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
		this.editorTabs.splice(index, 1);
		if (this.activeEditor === removed) {
			this.activeEditor = null;
		}
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
	}
}

export const editorTabGroup = new EditorTabGroupModel();
