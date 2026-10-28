import { inputFocus } from '../../../input/focus';
import { beginNavigationCapture, completeNavigation, withNavigationCaptureSuspended, type NavigationHistoryEntry } from '../../../navigation/navigation_history';
import type { EditorInput } from '../../common/editor_inputs';
import type { EditorGroupView, EditorTabOpenOptions } from './editor_group';

/** One group opening owns production, departure history and the eventual retained receiver. */
export class EditorOpeningRequest {
	private readonly generation: number;
	private readonly focusRevision: number;
	private departure: NavigationHistoryEntry | null;
	public activated = false;

	private constructor(private readonly group: EditorGroupView, private readonly options: EditorTabOpenOptions) {
		this.generation = group.panes.beginOpen();
		this.focusRevision = inputFocus.revision;
		this.departure = options.preserveFocus ? null : beginNavigationCapture();
	}

	public static begin(group: EditorGroupView, options: EditorTabOpenOptions): EditorOpeningRequest | undefined {
		if (!group.openingAdmitted || options.isCurrent?.() === false) return undefined;
		return new EditorOpeningRequest(group, options);
	}

	public admit<TInput extends EditorInput>(input: TInput | undefined): TInput | undefined {
		if (input === undefined) return undefined;
		const group = this.group, options = this.options;
		if (!group.openingAdmitted || this.generation !== group.panes.openGeneration || options.isCurrent?.() === false) {
			if (!group.model.contains(input)) input.dispose();
			return undefined;
		}
		const preserveFocus = options.preserveFocus || this.focusRevision !== inputFocus.revision;
		if (!withNavigationCaptureSuspended(() => group.openEditor(input, { ...options, preserveFocus }))) return undefined;
		// Matching input IDs identify the same editor kind; admission can retain an existing view and dispose the offer.
		const receiver = group.model.findById(input.id)! as TInput;
		if (!preserveFocus) {
			const previous = this.departure;
			this.departure = null;
			completeNavigation(previous);
		}
		this.activated = !preserveFocus;
		return receiver;
	}

	public dispose(): void {
		this.departure?.dispose();
		this.departure = null;
	}
}
