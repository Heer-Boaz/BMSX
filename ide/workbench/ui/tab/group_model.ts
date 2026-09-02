import type {
	BehaviorLensTabId,
	CodeEditorTabId,
	EditorTabId,
	ResourceViewerTabId,
} from './id';
import type {
	BehaviorLensTabDescriptor,
	CodeEditorTabDescriptor,
	EditorTabDescriptor,
	ResourceViewerTabDescriptor,
} from './model';

/**
 * Ordered editor inputs and their active selection. The active descriptor is
 * retained directly, matching the editor-group model used by mature IDEs.
 */
export class EditorTabGroupModel {
	private readonly editorTabs: EditorTabDescriptor[] = [];
	private activeEditor: EditorTabDescriptor | null = null;

	public get tabs(): readonly EditorTabDescriptor[] {
		return this.editorTabs;
	}

	public get activeTab(): EditorTabDescriptor | null {
		return this.activeEditor;
	}

	public initialize(initialTab: EditorTabDescriptor): void {
		this.clear();
		this.editorTabs.push(initialTab);
		this.activeEditor = initialTab;
	}

	public clear(): void {
		this.editorTabs.length = 0;
		this.activeEditor = null;
	}

	public add(tab: EditorTabDescriptor): void {
		this.editorTabs.push(tab);
	}

	public activate(tab: EditorTabDescriptor): void {
		this.activeEditor = tab;
	}

	public findById(tabId: CodeEditorTabId): CodeEditorTabDescriptor | undefined;
	public findById(tabId: ResourceViewerTabId): ResourceViewerTabDescriptor | undefined;
	public findById(tabId: BehaviorLensTabId): BehaviorLensTabDescriptor | undefined;
	public findById(tabId: EditorTabId): EditorTabDescriptor | undefined;
	public findById(tabId: EditorTabId): EditorTabDescriptor | undefined {
		for (let index = 0; index < this.editorTabs.length; index += 1) {
			const tab = this.editorTabs[index];
			if (tab.id === tabId) {
				return tab;
			}
		}
		return undefined;
	}

	public indexOf(tab: EditorTabDescriptor): number {
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
