import { readLuaNumberLiteral } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { parseLuaExpressionSource } from '../../../../toolchain/ts/lua/analysis/parse';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { readLuaSourceRange, createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits, validateLuaTableFieldExpression, formatLuaTableFieldSource } from '../../../language/lua/table_field_insertion';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { AnimationEditorController } from './controller';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationKeySource, AnimationClipSource, AnimationKeyUnit, AnimationTableSource } from './model';
import type { AnimationCurveField } from './curve';
import { ANIMATION_TRACK_TEMPLATES } from './track_templates';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import type { AnimationProperty } from './details';
import { animationPropertyEditState } from './source_selection';

/** Authored mutations and prompts. Admission/navigation belong to the controller. */
export class AnimationAuthoring {
	public constructor(private readonly controller: Pick<AnimationEditorController, 'modelFor' | 'refresh' | 'selectTrack' | 'selectKey' | 'selectProperty'>,
		private readonly catalog: WorkspaceSourceCatalog) {}
	public editProperty(input: AnimationEditorInput, property: AnimationProperty, value: LuaFieldValueEdit): void {
		const model = this.controller.modelFor(input, property.source.file), path = property.source.file.file;
		const previous = { path, range: luaSourceRangeToTextRange(model.buffer, property.source.file.chunk.locations.range(property.field.span)) };
		model.pushEditOperations([value.edit], animationPropertyEditState.of({ previous, selected: previous }, input.editSource), () =>
			animationPropertyEditState.of({ previous, selected: { path, range: luaSourceRangeToTextRange(model.buffer, value.fieldRange) } }, input.editSource));
		this.controller.refresh(input);
	}
	public moveKey(input: AnimationEditorInput, key: AnimationKeySource, value: number): void {
		const source = key.source!;
		const model = this.controller.modelFor(input, source.file);
		model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, key.coordinate!.field, value)!);
	}
	public canMoveKey(input: AnimationEditorInput, key: AnimationKeySource): boolean {
		return input.document?.syntaxComplete === true && key.source?.structural === true && key.coordinate !== undefined && readLuaNumberLiteral(key.coordinate.field.value) !== null
			&& !this.controller.modelFor(input, key.source.file).readOnly && input.keys.range.maximum > input.keys.range.minimum;
	}
	public canEditCurveField(input: AnimationEditorInput, key: AnimationKeySource, field: AnimationCurveField): boolean {
		return input.document?.syntaxComplete === true && key.source?.structural === true && key[field] !== undefined
			&& readLuaNumberLiteral(key[field]!.field.value) !== null && !this.controller.modelFor(input, key.source.file).readOnly;
	}
	public editCurveKey(input: AnimationEditorInput, key: AnimationKeySource, position: number | undefined, field: AnimationCurveField, value: number): void {
		const source = key.source!, model = this.controller.modelFor(input, source.file), edits: EditorTextEdit[] = [];
		if (position !== undefined) edits.push(...createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, key.coordinate!.field, position)!);
		edits.push(...createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, key[field]!.field, value)!);
		edits.sort((left, right) => left.offset - right.offset);
		if (edits.length > 0) model.pushEditOperations(edits);
	}
	public canEditClip(input: AnimationEditorInput, clip: AnimationClipSource, mode: 'move' | 'start' | 'end'): boolean {
		if (input.document?.syntaxComplete !== true || clip.source?.structural !== true || this.controller.modelFor(input, clip.source.file).readOnly) return false;
		if (clip.start !== undefined && readLuaNumberLiteral(clip.start.field.value) === null) return false;
		if (clip.duration === undefined || readLuaNumberLiteral(clip.duration.field.value) === null) return false;
		return mode !== 'start' || (clip.clipIn === undefined || readLuaNumberLiteral(clip.clipIn.field.value) !== null)
			&& (clip.timeScale === undefined || clip.timeScale.value !== null);
	}
	public editClip(input: AnimationEditorInput, clip: AnimationClipSource, mode: 'move' | 'start' | 'end', start: number, duration: number): void {
		const source = clip.source!, model = this.controller.modelFor(input, source.file), edits: EditorTextEdit[] = [];
		const fields: string[] = [];
		if (mode !== 'end') {
			if (clip.start === undefined) fields.push(`start_time_ms = ${start}`);
			else edits.push(...createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, clip.start.field, start)!);
		}
		if (mode !== 'move') edits.push(...createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, clip.duration!.field, duration)!);
		if (mode === 'start') {
			const value = (clip.clipIn === undefined ? 0 : clip.clipIn.value!) + (start - (clip.start === undefined ? 0 : clip.start.value!)) * (clip.timeScale === undefined ? 1 : clip.timeScale.value!);
			if (clip.clipIn === undefined) fields.push(`clip_in_ms = ${value}`);
			else edits.push(...createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, clip.clipIn.field, value)!);
		}
		if (fields.length > 0) edits.push(...createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, source.table.fields.length, fields));
		edits.sort((left, right) => left.offset - right.offset);
		if (edits.length > 0) model.pushEditOperations(edits);
	}

	public canAddTrack(input: AnimationEditorInput): boolean {
		const document = input.document;
		if (document?.syntaxComplete !== true || document.family !== 'timeline') return false;
		const source = document.tracksSource;
		if (source !== undefined) return source.structural && source.array && !this.controller.modelFor(input, source.file).readOnly;
		return document.root.structural && findNamedLuaTableField(document.root.table, 'tracks') === null
			&& !this.controller.modelFor(input, document.root.file).readOnly;
	}
	public addTrack(input: AnimationEditorInput, quickInput: QuickInputController): void {
		quickInput.pick('TRACK', 'Native track type', (_origin, lifetime) => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			return new TextQuickPickProvider(ANIMATION_TRACK_TEMPLATES);
		}, item => {
			if (!item.path) { this.insertTrack(input, item.create('')); return; }
			quickInput.input('PROPERTY PATH', "Lua path, e.g. {'visual', 'offset_x'}", "{'x'}", async value => validateLuaTableFieldExpression(value), path => {
				this.insertTrack(input, item.create(path));
			}, lifetime => {
				lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			});
		});
	}
	private insertTrack(input: AnimationEditorInput, track: string): void {
		const document = input.document!, source = document.tracksSource === undefined ? document.root : document.tracksSource;
		const model = this.controller.modelFor(input, source.file);
		model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, source.table.fields.length,
			[document.tracksSource === undefined ? `tracks = { ${track} }` : track]));
		this.controller.refresh(input); this.controller.selectTrack(input, input.document!.tracks.length);
	}

	public canAddKey(input: AnimationEditorInput): boolean {
		const track = input.document?.tracks[input.trackIndex];
		return input.document?.syntaxComplete === true && (track?.kind === 'value' || track?.kind === 'event') && track.keysSource?.structural === true
			&& track.keysSource.array && !this.controller.modelFor(input, track.keysSource.file).readOnly;
	}
	public addKey(input: AnimationEditorInput, quickInput: QuickInputController): void {
		const track = input.document!.tracks[input.trackIndex];
		if (track.unit !== undefined) { this.insertKey(input, quickInput, track.unit, input.keys.cursor); return; }
		quickInput.pick('KEY COORDINATE', 'Native unit', (_origin, lifetime) => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			return new TextQuickPickProvider(KEY_UNITS);
		}, item => {
			quickInput.input(item.label, 'Position', '0', async text => {
				validateLuaTableFieldExpression(text);
				const expression = parseLuaExpressionSource(text, '[key]').expression;
				const value = readLuaNumberLiteral(expression);
				if (value === null) throw new Error('Numeric literal required');
				return value;
			}, value => this.insertKey(input, quickInput, item.unit, value), lifetime => {
				lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			});
		});
	}
	private insertKey(input: AnimationEditorInput, quickInput: QuickInputController, unit: AnimationKeyUnit, time: number): void {
		const track = input.document!.tracks[input.trackIndex], source = track.keysSource!;
		const event = track.kind === 'event';
		quickInput.input(event ? 'EVENT' : 'KEY VALUE', `${unit} = ${time}`, event ? "'animation.event'" : '0', async text => validateLuaTableFieldExpression(text), value => {
			const tangents = track.interpolation === 'cubic' ? ', arrive_tangent = 0, leave_tangent = 0' : '';
			this.controller.modelFor(input, source.file).pushEditOperations(createLuaTableFieldsInsertionEdits(this.controller.modelFor(input, source.file).buffer,
				source.file.chunk, source.table, source.table.fields.length, [`{ ${unit} = ${time}, ${event ? "direction = 'forward', event" : 'value'} = ${value}${tangents} }`]));
			this.controller.refresh(input);
			this.controller.selectKey(input, input.document!.tracks[input.trackIndex].keys.length - 1);
		}, lifetime => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
		});
	}
	public canRemove(input: AnimationEditorInput): boolean {
		if (input.clipIndex >= 0) return input.document?.syntaxComplete === true && input.document.clipsSource?.structural === true
			&& !this.controller.modelFor(input, input.document.clipsSource.file).readOnly;
		if (input.framesSelected) return input.document?.syntaxComplete === true && input.document.framesSource?.structural === true
			&& input.details.selectionIndex >= 0 && !this.controller.modelFor(input, input.document.framesSource.file).readOnly;
		const track = input.document?.tracks[input.trackIndex];
		const source = input.keyIndex >= 0 ? track?.keysSource : input.document?.tracksSource;
		return input.document?.syntaxComplete === true && track !== undefined && source?.structural === true && (input.keyIndex < 0 || track.kind !== 'value' || track.keys.length > 1)
			&& !this.controller.modelFor(input, source.file).readOnly;
	}
	public remove(input: AnimationEditorInput): void {
		if (input.clipIndex >= 0 || input.framesSelected) {
			const source = input.framesSelected ? input.document!.framesSource! : input.document!.clipsSource!;
			const field = input.framesSelected ? input.details.rows[input.details.selectionIndex].element.field : input.document!.clips[input.clipIndex].field;
			const model = this.controller.modelFor(input, source.file);
			model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, source.file.chunk.locations, source.file.chunk.tokens, field)); return;
		}
		const track = input.document!.tracks[input.trackIndex];
		const key = track.keys[input.keyIndex];
		const source = input.keyIndex >= 0 ? track.keysSource! : input.document!.tracksSource!;
		const field = input.keyIndex >= 0 ? key.field : track.field;
		this.controller.modelFor(input, source.file).pushEditOperations(createLuaTableFieldRemovalEdits(this.controller.modelFor(input, source.file).buffer,
			source.file.chunk.locations, source.file.chunk.tokens, field));
	}
	public canAddClip(input: AnimationEditorInput): boolean {
		const document = input.document;
		if (document?.syntaxComplete !== true || document.family !== 'timeline') return false;
		const source = document.clipsSource;
		return source === undefined ? document.root.structural && findNamedLuaTableField(document.root.table, 'subsequences') === null
			&& !this.controller.modelFor(input, document.root.file).readOnly : source.structural && source.array && !this.controller.modelFor(input, source.file).readOnly;
	}
	public addClip(input: AnimationEditorInput, quickInput: QuickInputController): void {
		const document = input.document!, source = document.clipsSource === undefined ? document.root : document.clipsSource;
		quickInput.input('CHILD SEQUENCE', 'Definition or require(...)', '{duration_ms = 100, tracks = {}}',
			async value => validateLuaTableFieldExpression(value), sequence => {
				const clip = `{id = 'clip${document.clips.length + 1}', start_time_ms = 0, duration_ms = 100, sequence = ${sequence}}`;
				const model = this.controller.modelFor(input, source.file);
				model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, source.table.fields.length,
					[document.clipsSource === undefined ? `subsequences = { ${clip} }` : clip]));
				this.controller.refresh(input); this.controller.selectTrack(input, input.document!.tracks.length + input.document!.clips.length);
			}, lifetime => {
				lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			});
	}
	public canAddFrame(input: AnimationEditorInput): boolean {
		const document = input.document;
		if (document?.syntaxComplete !== true) return false;
		const source = document.framesSource;
		return source === undefined ? document.root.structural && document.framesField === undefined && !this.controller.modelFor(input, document.root.file).readOnly
			: source.structural && source.array && !this.controller.modelFor(input, source.file).readOnly;
	}
	public addFrame(input: AnimationEditorInput, quickInput: QuickInputController): void {
		if (input.document!.family === 'sprite') {
			quickInput.pick('FRAME IMAGE', 'Packed image reference', (_origin, lifetime) => {
				lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
				return new TextQuickPickProvider([...this.catalog.getAssetBindings(input.projectContextId, 'img')].map(([id, binding]) => ({ asset: binding.value,
					label: id, description: `${binding.value.imgmeta!.width} x ${binding.value.imgmeta!.height}`, detail: '' })).sort((left, right) => left.label.localeCompare(right.label)));
			}, item => this.insertFrame(input, quoteLuaString(item.label)));
			return;
		}
		quickInput.input('FRAME', 'Native Lua frame value', '{}', async value => validateLuaTableFieldExpression(value), frame => this.insertFrame(input, frame), lifetime => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
		});
	}
	private insertFrame(input: AnimationEditorInput, frame: string): void {
		const document = input.document!, source = document.framesSource === undefined ? document.root : document.framesSource;
		const index = document.framesSource === undefined ? 0 : input.framesSelected && input.details.selectionIndex >= 0 ? input.details.selectionIndex + 1 : source.table.fields.length;
		const model = this.controller.modelFor(input, source.file);
		model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, index,
			[document.framesSource === undefined ? `frames = { ${frame} }` : frame]));
		this.controller.refresh(input); this.controller.selectTrack(input, input.tracks.rows.length - 1);
		this.controller.selectProperty(input, index); input.keys.setCursor(index); input.keys.reveal(index, index + 1);
	}
	public canAddProperty(input: AnimationEditorInput): boolean {
		const source = input.selectedSource;
		return !input.framesSelected && input.document?.syntaxComplete === true && source?.structural === true && !this.controller.modelFor(input, source.file).readOnly;
	}
	public addProperty(input: AnimationEditorInput, quickInput: QuickInputController): void {
		const source = input.selectedSource!;
		quickInput.input('PROPERTY', 'Native field name', '', async name => {
			if (name.length === 0) throw new Error('Name required');
			if (findNamedLuaTableField(source.table, name) !== null) throw new Error('Property exists');
			return name;
		}, name => {
			quickInput.input(name, 'Lua value', 'nil', async value => validateLuaTableFieldExpression(value), value => {
				const model = this.controller.modelFor(input, source.file);
				model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, source.table.fields.length, [formatLuaTableFieldSource(name, value)]));
			}, lifetime => {
				lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
			});
		}, lifetime => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => quickInput.hide()) });
		});
	}
	private orderedSource(input: AnimationEditorInput): AnimationTableSource | undefined {
		const document = input.document;
		return input.framesSelected ? document?.framesSource : input.clipIndex >= 0 ? document?.clipsSource
			: input.keyIndex >= 0 ? document?.tracks[input.trackIndex]?.keysSource : input.trackIndex >= 0 ? document?.tracksSource : undefined;
	}
	private orderedField(input: AnimationEditorInput): LuaTableField | undefined {
		return input.framesSelected ? input.details.rows[input.details.selectionIndex]?.element.field : input.clipIndex >= 0 ? input.document?.clips[input.clipIndex].field
			: input.keyIndex >= 0 ? input.document?.tracks[input.trackIndex].keys[input.keyIndex].field : input.document?.tracks[input.trackIndex]?.field;
	}
	public canDuplicate(input: AnimationEditorInput): boolean {
		const source = this.orderedSource(input);
		return input.document?.syntaxComplete === true && source?.structural === true && source.array && this.orderedField(input) !== undefined
			&& !this.controller.modelFor(input, source.file).readOnly;
	}
	public duplicate(input: AnimationEditorInput): void {
		const source = this.orderedSource(input)!, field = this.orderedField(input)!, model = this.controller.modelFor(input, source.file);
		const index = source.table.fields.indexOf(field) + 1;
		const selection = input.framesSelected ? 'frame' : input.clipIndex >= 0 ? 'clip' : input.keyIndex >= 0 ? 'key' : 'track', trackIndex = input.trackIndex;
		model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, source.file.chunk, source.table, index,
			[readLuaSourceRange(model.buffer, source.file.chunk.locations.range(field.span))]));
		this.controller.refresh(input);
		this.selectOrderedEntry(input, selection, index, trackIndex);
	}
	public canReorder(input: AnimationEditorInput, direction: -1 | 1): boolean {
		if (!this.canDuplicate(input)) return false;
		const source = this.orderedSource(input)!, index = source.table.fields.indexOf(this.orderedField(input)!);
		return index + direction >= 0 && index + direction < source.table.fields.length;
	}
	public reorder(input: AnimationEditorInput, direction: -1 | 1): void {
		const source = this.orderedSource(input)!, index = source.table.fields.indexOf(this.orderedField(input)!), model = this.controller.modelFor(input, source.file);
		const selection = input.framesSelected ? 'frame' : input.clipIndex >= 0 ? 'clip' : input.keyIndex >= 0 ? 'key' : 'track', trackIndex = input.trackIndex;
		model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, source.file.chunk, source.table, index, index + direction));
		this.controller.refresh(input);
		this.selectOrderedEntry(input, selection, index + direction, trackIndex);
	}
	/** A structural edit chooses its new occurrence explicitly; tracked ranges only retain unmodified occurrences. */
	private selectOrderedEntry(input: AnimationEditorInput, selection: 'frame' | 'clip' | 'key' | 'track', index: number, trackIndex: number): void {
		if (selection === 'frame') {
			this.controller.selectTrack(input, input.tracks.rows.length - 1);
			this.controller.selectProperty(input, index); input.keys.setCursor(index); input.keys.reveal(index, index + 1);
		} else if (selection === 'key') {
			this.controller.selectTrack(input, trackIndex + 1); this.controller.selectKey(input, index);
		} else this.controller.selectTrack(input, selection === 'clip' ? input.document!.tracks.length + 1 + index : index + 1);
	}
}

const KEY_UNITS = [
	{ label: 'Milliseconds', description: '', detail: '', unit: 'time_ms' },
	{ label: 'Frames', description: '', detail: '', unit: 'frame' },
	{ label: 'Normalized', description: '', detail: '', unit: 'u' },
] as const;
