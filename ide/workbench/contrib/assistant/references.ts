import type { ResourceIdentity } from '../../../common/resource';
import { TextStyle } from '../../../common/markdown/model';
import { getCursorOffset, insertAnnotatedValue, setCursorFromOffset, setSelectionAnchorFromOffset } from '../../../editor/ui/inline/text_field';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';
import { InlineSuggestions } from '../../ui/inline_suggestions';
import type { AssistantInput } from './editor_input';

type SourcePick = { label: string; description: string; detail: string; resource: ResourceIdentity };
const WORD_BREAK = /\s/;

/** Completion owns the query; selected references live in the field's tracked source ranges. */
export class AssistantReferences {
	public readonly suggestions = new InlineSuggestions<SourcePick>(item => this.accept(item));
	private input: AssistantInput;
	private text = '';
	private caret = -1;
	private from = -1;
	private to = -1;
	public clear(): void { this.suggestions.hide(); this.caret = -1; this.from = -1; }
	public update(input: AssistantInput): void {
		this.input = input;
		const field = input.draft, caret = getCursorOffset(field);
		if (!field.focusTarget.hasFocus) { this.suggestions.hide(); return; }
		if (field.text !== this.text || caret !== this.caret) {
			this.text = field.text; this.caret = caret;
			let from = caret;
			while (from > 0 && !WORD_BREAK.test(field.text[from - 1])) from--;
			const annotated = field.annotations.some(span => from >= span.from && caret <= span.to);
			const style = input.draftMarkdown.styles.find(span => span.from <= from && span.to > from);
			if (field.text[from] !== '@' || annotated || (style !== undefined && (style.style & TextStyle.Code) !== 0)) {
				this.suggestions.hide(); this.from = -1;
			} else {
				if (!this.suggestions.visible || this.from !== from) {
					const picks = input.conversation.referenceSources().map(resource => ({ label: resource.path,
						description: resource.domain === -1 ? 'System source' : `Slot ${resource.domain}`, detail: '', resource }));
					this.suggestions.open(new FileQuickPickProvider(picks));
				}
				this.from = from; this.to = caret;
				while (this.to < field.text.length && !WORD_BREAK.test(field.text[this.to])) this.to++;
				this.suggestions.model.filter(field.text.slice(from + 1, caret));
			}
		}
		this.suggestions.update(input.composerBounds, input.layout.top);
	}
	private accept(item: SourcePick): void {
		const field = this.input.draft;
		setSelectionAnchorFromOffset(field, this.from); setCursorFromOffset(field, this.to);
		insertAnnotatedValue(field, `@${item.resource.path}`, item.resource, ' ');
		this.suggestions.hide(); this.from = -1;
		this.text = field.text; this.caret = getCursorOffset(field);
	}
}
