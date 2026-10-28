import { inputFocus } from '../../../input/focus';
import { beginNavigationCapture, completeNavigation, withNavigationCaptureSuspended, type NavigationHistoryEntry } from '../../../navigation/navigation_history';
import type { EditorInput } from '../../common/editor_inputs';
import type { EditorGroupView, EditorTabOpenOptions } from './editor_group';

/** A contribution owns any selection lease until the opening consumes or retires it. */
export type PreparedEditorInput<TInput extends EditorInput = EditorInput> = {
	readonly input: TInput;
	readonly options?: Pick<EditorTabOpenOptions, 'selection' | 'navigationSelection'>;
	dispose?(): void;
};

/** An unopened source resolves only for its actual prospective receiver, never a temporary attachment. */
export type ProspectiveEditorOpenSource = {
	readonly kind: 'opening';
	isCurrent(): boolean;
	findExisting(group: EditorGroupView): EditorInput | undefined;
	resolve(group: EditorGroupView): PreparedEditorInput | undefined | Promise<PreparedEditorInput | undefined>;
};

/** One group opening owns production, departure history and the eventual retained receiver. */
export class EditorOpeningRequest {
	private readonly generation: number;
	private readonly focusRevision: number;
	private departure: NavigationHistoryEntry | null;
	public activated = false;

	private constructor(private readonly group: EditorGroupView, private readonly options: EditorTabOpenOptions, focusRevision: number) {
		this.generation = group.panes.beginOpen();
		this.focusRevision = focusRevision;
		this.departure = options.preserveFocus ? null : beginNavigationCapture();
	}

	public static begin(group: EditorGroupView, options: EditorTabOpenOptions): EditorOpeningRequest | undefined {
		const generation = group.panes.openGeneration, focusRevision = inputFocus.revision;
		if (options.isCurrent?.() === false || !group.openingAdmitted || group.panes.openGeneration !== generation) return undefined;
		return new EditorOpeningRequest(group, options, focusRevision);
	}

	public get isCurrent(): boolean {
		return this.options.isCurrent?.() !== false && this.group.openingAdmitted && this.generation === this.group.panes.openGeneration;
	}

	public admit<TInput extends EditorInput>(input: TInput | undefined,
		paneOptions?: PreparedEditorInput['options'], receiver: EditorGroupView = this.group): TInput | undefined {
		if (input === undefined) return undefined;
		const options = this.options;
		if (!this.isCurrent) {
			if (!receiver.model.contains(input)) input.dispose();
			return undefined;
		}
		const preserveFocus = options.preserveFocus || this.focusRevision !== inputFocus.revision;
		const result = withNavigationCaptureSuspended(() => receiver.openEditor(input, { ...options, ...paneOptions, preserveFocus, isCurrent: () => this.isCurrent }));
		if (result === undefined) return undefined;
		// Matching input IDs identify the same editor kind; admission can retain an existing view and dispose the offer.
		const retained = receiver.model.findById(input.id)! as TInput;
		if (result.activated) {
			const previous = this.departure;
			this.departure = null;
			completeNavigation(previous);
		}
		this.activated = result.activated;
		return retained;
	}

	public dispose(): void {
		this.departure?.dispose();
		this.departure = null;
	}
}
