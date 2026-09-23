import { UNDO_HISTORY_LIMIT } from '../../common/constants';
import type { EditorUndoRecord } from '../text/undo';
import type { EditorTextModel, EditorModelEdit } from './text_model';

type WorkspaceUndoRecord = {
	readonly kind: 'workspace';
	order: number;
	readonly records: readonly EditorUndoRecord[];
};
type HistoryElement = EditorUndoRecord | WorkspaceUndoRecord;
type HistoryStack = { readonly undo: HistoryElement[]; readonly redo: HistoryElement[] };
export type EditorHistoryDirection = 'undo' | 'redo';

/** A proposal outlived its source generation, or now includes a read-only source. */
export class EditorWorkspaceEditConflict extends Error {
	public constructor(model: EditorTextModel, reason = model.readOnly ? 'is read-only' : 'changed since the proposal was made') {
		super(`Source edit cancelled: ${model.resource.path} ${reason}.`);
	}
}

/** A real history dependency, not a corrupt-text recovery path. */
export class EditorHistoryConflict extends Error {
	public constructor(direction: EditorHistoryDirection, model: EditorTextModel) {
		super(`Cannot ${direction} across files: ${model.resource.path} has ${model.readOnly ? 'become read-only' : `other changes to ${direction} first`}.`);
	}
}

/**
 * Resource stacks share workspace elements (VS Code's UndoRedoService/editStack).
 * The piece tree and its inverse operations stay in the text model. A compound
 * edit is never split into independent file edits on a history conflict.
 */
export class EditorUndoRedoService {
	private readonly stacks = new Map<EditorTextModel, HistoryStack>();
	private order = 0;

	public register(model: EditorTextModel): void {
		this.stacks.set(model, { undo: [], redo: [] });
	}

	public canUndo(model: EditorTextModel): boolean { return this.stacks.get(model)!.undo.length > 0; }
	public canRedo(model: EditorTextModel): boolean { return this.stacks.get(model)!.redo.length > 0; }

	/** A composite source view uses the nearest stack head, never a private history. */
	public findModel(models: readonly EditorTextModel[], direction: EditorHistoryDirection): EditorTextModel | undefined {
		let selected: EditorTextModel | undefined;
		let nearest: HistoryElement | undefined;
		for (const model of models) {
			const element = this.stacks.get(model)![direction].at(-1);
			if (element !== undefined && (nearest === undefined
				|| (direction === 'undo' ? element.order > nearest.order : element.order < nearest.order))) {
				selected = model;
				nearest = element;
			}
		}
		return selected;
	}

	/** Only a single-resource element can accept more typing. */
	public lastRecord(model: EditorTextModel): EditorUndoRecord | undefined {
		const last = this.stacks.get(model)!.undo.at(-1);
		return last?.kind === 'resource' && last.order === this.order ? last : undefined;
	}

	/** All target models/revisions are admitted before the first source write. */
	public applyEdits(edits: ReadonlyMap<EditorTextModel, EditorModelEdit>): void {
		const participants = [...edits].filter(([, edit]) => edit.edits.length > 0);
		for (const [model, { version }] of participants) {
			if (!this.stacks.has(model)) throw new EditorWorkspaceEditConflict(model, 'no longer belongs to this workspace');
			if (model.version !== version || model.readOnly) throw new EditorWorkspaceEditConflict(model);
		}
		if (participants.length === 0) return;
		// Invalidate every pre-edit source projection before changing any buffer.
		const records = participants.map(([model, edit]) => model.beginEditOperations(edit.beforeEditState));
		const dirtyBefore = records.map(record => record.model.dirty);
		this.push(records.length === 1 ? records[0] : { kind: 'workspace', order: 0, records });
		const applied = records.map((record, index) => record.model.applyEditOperations(record, participants[index][1].edits));
		for (let index = 0; index < records.length; index += 1) {
			records[index].model.endEditOperations(records[index], applied[index], dirtyBefore[index], participants[index][1].computeAfterEditState);
		}
	}

	public undo(model: EditorTextModel): EditorUndoRecord | null { return this.replay(model, 'undo', 'redo'); }
	public redo(model: EditorTextModel): EditorUndoRecord | null { return this.replay(model, 'redo', 'undo'); }

	private replay(model: EditorTextModel, from: EditorHistoryDirection, to: EditorHistoryDirection): EditorUndoRecord | null {
		const element = this.stacks.get(model)![from].at(-1);
		if (element === undefined) return null;
		if (element.kind === 'resource') {
			if (model.readOnly) throw new EditorHistoryConflict(from, model);
			model.beginHistoryReplay();
			const wasDirty = model.dirty;
			this.move(element, element, from, to);
			const applied = model.applyHistoryRecord(element, from);
			model.endHistoryReplay(element, from, applied, wasDirty);
			return element;
		}
		for (const record of element.records) {
			if (record.model.readOnly || this.stacks.get(record.model)![from].at(-1) !== element) {
				throw new EditorHistoryConflict(from, record.model);
			}
		}
		for (const record of element.records) record.model.beginHistoryReplay();
		const dirtyBefore = element.records.map(record => record.model.dirty);
		for (const record of element.records) this.move(element, record, from, to);
		const applied = element.records.map(record => record.model.applyHistoryRecord(record, from));
		for (let index = 0; index < element.records.length; index += 1) {
			const record = element.records[index];
			record.model.endHistoryReplay(record, from, applied[index], dirtyBefore[index]);
		}
		return element.records.find(record => record.model === model)!;
	}

	private move(element: HistoryElement, record: EditorUndoRecord, from: EditorHistoryDirection, to: EditorHistoryDirection): void {
		const stack = this.stacks.get(record.model)!;
		stack[from].pop();
		stack[to].push(element);
	}

	public push(element: HistoryElement): void {
		element.order = ++this.order;
		if (element.kind === 'resource') {
			this.prepareStack(element.model);
			this.stacks.get(element.model)!.undo.push(element);
		} else {
			for (const record of element.records) this.prepareStack(record.model);
			for (const record of element.records) this.stacks.get(record.model)!.undo.push(element);
		}
	}

	private prepareStack(model: EditorTextModel): void {
		const stack = this.stacks.get(model)!;
		this.discardPrefix(stack.redo, stack.redo.length, 'redo');
		if (stack.undo.length >= UNDO_HISTORY_LIMIT) this.discardPrefix(stack.undo, 1, 'undo');
	}

	/**
	 * Retention/revert/branching discard complete dependency prefixes. In another
	 * resource a forgotten shared edit becomes a history boundary, never a hole
	 * through which an older inverse edit could run against the wrong text.
	 */
	private discardPrefix(stack: HistoryElement[], count: number, direction: EditorHistoryDirection): void {
		if (count === 0) return;
		// The ordinary typing retention path needs no worklist or temporary array.
		const record = stack[0];
		if (count === 1 && record.kind === 'resource') {
			stack.shift();
			record.model.releaseUndoRecord(record);
			return;
		}
		const pending = new Set(stack.splice(0, count));
		for (const element of pending) {
			if (element.kind === 'resource') element.model.releaseUndoRecord(element);
			else for (const record of element.records) {
				const other = this.stacks.get(record.model)![direction];
				const index = other.indexOf(element);
				if (index >= 0) for (const removed of other.splice(0, index + 1)) pending.add(removed);
				record.model.releaseUndoRecord(record);
			}
		}
	}

	public clear(model: EditorTextModel): void {
		const stack = this.stacks.get(model)!;
		this.discardPrefix(stack.undo, stack.undo.length, 'undo');
		this.discardPrefix(stack.redo, stack.redo.length, 'redo');
		model.breakUndoSequence();
	}

	public remove(model: EditorTextModel): void {
		this.clear(model);
		this.stacks.delete(model);
	}
}
