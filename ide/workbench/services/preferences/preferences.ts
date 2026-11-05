import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceUiScale } from '../../common/display_scale';

const UI_SCALE_KEY = 'bmsx.studio.uiScale';

/** User display preferences belong to this frontend's storage, not a project's
 * recovery records. Browser roots use device storage; isolated hosts use window storage. */
export class WorkbenchPreferences {
	private uiScaleValue: WorkspaceUiScale;
	private readonly listeners = new Set<() => void>();
	public constructor(private readonly storage: KeyValueStorage) {
		const saved = storage.getItem(UI_SCALE_KEY);
		this.uiScaleValue = saved === null ? 1 : JSON.parse(saved);
	}
	public get uiScale(): WorkspaceUiScale { return this.uiScaleValue; }
	public set uiScale(value: WorkspaceUiScale) {
		if (this.uiScaleValue === value) return;
		this.uiScaleValue = value;
		this.storage.setItem(UI_SCALE_KEY, JSON.stringify(value));
		for (const listener of this.listeners) listener();
	}
	public onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
