import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange, readLuaNumberLiteral, createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits, validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import { mapTrackedTextRange } from '../../../editor/text/text_change';
import { resolveRuntimeResourceForContext, runtimeLuaSourceRegistry, type RuntimeSourceState } from '../../../runtime/sources';
import { onDidChangeLuaSourceRegistry } from '../../../runtime/source_registry';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { ResourceDomain, RuntimeResource } from '../../../common/resource';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { EditorNavigationController } from '../resources/navigation';
import { AnimationEditorInput, type AnimationSourceSelection } from './editor_input';
import { buildAnimationSourceDocument } from './source';
import { projectAnimationDetails } from './details';
import type { AnimationKeySource } from './model';
import { animationDefinitionAtPosition, animationDefinitionAtRange, collectAnimationDefinitions, type AnimationDefinitionSource } from './definitions';

/** Admits source generations, selects syntax and issues edits through their real working copies. */
export class AnimationEditorController {
	public constructor(private readonly sources: RuntimeSourceState, private readonly panes: EditorPanes,
		private readonly navigation: EditorNavigationController, private readonly quickInput: QuickInputController) {}

	public open(): void {
		const snapshots = new Map<ResourceDomain, LuaSemanticWorkspaceSnapshot>();
		const snapshotFor = (domain: ResourceDomain): LuaSemanticWorkspaceSnapshot => {
			let snapshot = snapshots.get(domain);
			if (snapshot === undefined) {
				const project = getOrCreateSemanticProject(editorTextModelService, domain);
				project.synchronizeRuntimeSources(this.sources);
				snapshot = project.getSnapshot(); snapshots.set(domain, snapshot);
			}
			return snapshot;
		};
		const active = editorTabGroup.activeTab;
		if (active?.kind === 'code_editor' && active.workingCopy.mode === 'lua') {
			const model = active.workingCopy, snapshot = snapshotFor(model.resource.domain), file = snapshot.getFileData(model.resource.path)!;
			const table = animationDefinitionAtPosition(file, activeCodeEditor.view.cursorRow + 1, activeCodeEditor.view.cursorColumn + 1);
			if (table !== undefined) {
				this.openDefinition(model.resource.domain, { file, table, label: `${model.resource.path}:${file.chunk.locations.range(table.span).start.line}` });
				return;
			}
			if (buildAnimationSourceDocument(model.resource, snapshot) !== undefined) { this.openResource(model.resource); return; }
		}
		const choices: { label: string; description: string; detail: string; domain: ResourceDomain; definition: AnimationDefinitionSource }[] = [];
		const admitted = new Map<ResourceDomain, Set<LuaTableConstructorExpression>>();
		for (const resource of this.sources.luaResources) {
			let seen = admitted.get(resource.domain);
			if (seen === undefined) { seen = new Set(); admitted.set(resource.domain, seen); }
			for (const definition of collectAnimationDefinitions(resource, snapshotFor(resource.domain))) {
				if (seen.has(definition.table)) continue;
				seen.add(definition.table);
				const range = definition.file.chunk.locations.range(definition.table.span);
				choices.push({ label: definition.label, description: definition.context === undefined ? definition.file.file : `${definition.context} / ${definition.file.file}`,
					detail: `${resource.domain === -1 ? 'SYSTEM' : `SLOT ${resource.domain}`} / ${range.start.line}:${range.start.column}`,
					domain: resource.domain, definition });
			}
		}
		this.quickInput.pick('ANIMATIONS', 'Choose a written definition', (_origin, lifetime) => {
			const retire = () => this.quickInput.hide();
			lifetime.add({ dispose: editorTextModelService.onDidChangeContent(retire) });
			lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
			for (const domain of snapshots.keys()) lifetime.add({ dispose: onDidChangeLuaSourceRegistry(runtimeLuaSourceRegistry(this.sources, domain)!, retire) });
			return new TextQuickPickProvider(choices);
		},
			item => this.openDefinition(item.domain, item.definition));
	}

	public openDefinition(domain: ResourceDomain, definition: AnimationDefinitionSource): AnimationEditorInput {
		const resource = resolveRuntimeResourceForContext(this.sources, domain, definition.file.file)!;
		const model = resolveLuaTextFileModel(editorTextModelService, this.sources, resource);
		const range = definition.file.chunk.locations.range(definition.table.span);
		let input = editorTabGroup.tabs.find((item): item is AnimationEditorInput => item.kind === 'animation'
			&& item.workingCopy === model && item.definitionRange !== undefined && luaSourceRangeMatchesTextRange(model.buffer, range, item.definitionRange));
		if (input === undefined) {
			input = new AnimationEditorInput(model, luaSourceRangeToTextRange(model.buffer, range), definition.label);
			this.refresh(input);
		}
		openEditorTab(this.panes, input);
		return input;
	}

	public openResource(resource: RuntimeResource): AnimationEditorInput {
		const model = resolveLuaTextFileModel(editorTextModelService, this.sources, resource);
		let input = editorTabGroup.tabs.find((item): item is AnimationEditorInput => item.kind === 'animation' && item.workingCopy === model && item.definitionRange === undefined);
		if (input === undefined) { input = new AnimationEditorInput(model); this.refresh(input); }
		openEditorTab(this.panes, input);
		return input;
	}

	public modelFor(input: AnimationEditorInput, file: FileSemanticData): EditorTextModel {
		let model = input.sourceModels.get(file.file);
		if (model === undefined) {
			const resource = resolveRuntimeResourceForContext(this.sources, input.workingCopy.resource.domain, file.file)!;
			model = resolveLuaTextFileModel(editorTextModelService, this.sources, resource);
			input.sourceModels.set(file.file, model);
		}
		return model;
	}

	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind !== 'animation' || input.sourceModels.get(model.resource.path) !== model) continue;
			input.invalidateProjection();
			if (input.workingCopy === model && input.definitionRange !== undefined) mapTrackedTextRange(input.definitionRange, event.changes);
			if (input.trackSelection?.path === model.resource.path) mapTrackedTextRange(input.trackSelection.range, event.changes);
			if (input.keySelection?.path === model.resource.path) mapTrackedTextRange(input.keySelection.range, event.changes);
		}
	}

	public refresh(input: AnimationEditorInput): void {
		const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		const snapshot = project.getSnapshot();
		if (snapshot.revision === input.sourceRevision) return;
		input.invalidateProjection();
		input.sourceRevision = snapshot.revision;
		const definition = input.definitionRange === undefined ? undefined
			: animationDefinitionAtRange(snapshot.getFileData(input.workingCopy.resource.path)!, input.workingCopy.buffer, input.definitionRange);
		input.document = input.definitionRange !== undefined && definition === undefined ? undefined
			: buildAnimationSourceDocument(input.workingCopy.resource, snapshot, definition);
		input.tracks.rows.length = 0;
		input.trackIndex = -1; input.keyIndex = -1;
		const document = input.document;
		if (document !== undefined) {
			this.modelFor(input, document.root.file);
			input.tracks.rows.push({ track: undefined, label: 'Animation', text: '' });
			if (document.tracksSource !== undefined) this.modelFor(input, document.tracksSource.file);
			for (let index = 0; index < document.tracks.length; index++) {
				const track = document.tracks[index];
				const model = this.modelFor(input, track.file);
				if (this.matches(input.trackSelection, model, track.file, track.field)) input.trackIndex = index;
				if (track.source !== undefined) this.modelFor(input, track.source.file);
				if (track.keysSource !== undefined) this.modelFor(input, track.keysSource.file);
				for (let keyIndex = 0; keyIndex < track.keys.length; keyIndex++) {
					const key = track.keys[keyIndex];
					const owner = this.modelFor(input, key.file);
					if (index === input.trackIndex && this.matches(input.keySelection, owner, key.file, key.field)) input.keyIndex = keyIndex;
					if (key.source !== undefined) this.modelFor(input, key.source.file);
				}
				input.tracks.rows.push({ track, label: track.label, text: '' });
			}
		}
		if (input.trackIndex === -1) input.trackSelection = undefined;
		if (input.keyIndex === -1) input.keySelection = undefined;
		input.tracks.selectionIndex = document === undefined ? -1 : input.trackIndex + 1;
		this.refreshDetails(input);
		input.keys.bind(document?.tracks[input.trackIndex], input.keyIndex, document);
		input.status = document === undefined ? 'Definition unavailable' : !document.syntaxComplete ? 'Incomplete source' : 'Authored Lua';
		input.version += 1;
	}

	private matches(selection: AnimationSourceSelection | undefined, model: EditorTextModel, file: FileSemanticData, field: LuaTableField): boolean {
		return selection !== undefined && selection.path === file.file
			&& luaSourceRangeMatchesTextRange(model.buffer, file.chunk.locations.range(field.span), selection.range);
	}

	public selectTrack(input: AnimationEditorInput, rowIndex: number): void {
		const track = input.tracks.rows[rowIndex]?.track;
		input.trackIndex = rowIndex - 1;
		input.tracks.selectionIndex = rowIndex;
		input.trackSelection = track === undefined ? undefined : { path: track.file.file,
			range: luaSourceRangeToTextRange(this.modelFor(input, track.file).buffer, track.file.chunk.locations.range(track.field.span)) };
		input.keySelection = undefined; input.keyIndex = -1;
		input.keys.bind(track, -1, input.document);
		this.refreshDetails(input);
	}

	public selectKey(input: AnimationEditorInput, index: number): void {
		const key = input.document!.tracks[input.trackIndex].keys[index];
		input.keyIndex = index;
		input.keySelection = index < 0 ? undefined : { path: key.file.file,
			range: luaSourceRangeToTextRange(this.modelFor(input, key.file).buffer, key.file.chunk.locations.range(key.field.span)) };
		input.keys.select(index);
		this.refreshDetails(input);
	}

	private refreshDetails(input: AnimationEditorInput): void {
		const document = input.document;
		const track = document?.tracks[input.trackIndex];
		const source = input.keyIndex >= 0 ? track!.keys[input.keyIndex].source : input.trackIndex >= 0 ? track?.source : document?.root;
		let excluded: readonly string[] = [];
		if (input.keyIndex < 0) {
			if (input.trackIndex >= 0) {
				if (track?.keysSource?.structural === true && track.keysSource.array) excluded = ['keys'];
			} else if (document?.tracksSource?.structural === true && document.tracksSource.array) excluded = ['tracks'];
		}
		projectAnimationDetails(input.details, source, file => this.modelFor(input, file), document?.reader, excluded);
		input.publishModels();
	}

	public moveKey(input: AnimationEditorInput, key: AnimationKeySource, value: number): void {
		const source = key.source!;
		const model = this.modelFor(input, source.file);
		model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer, source.file.chunk.locations, key.coordinate!.field, value)!);
	}
	public canMoveKey(input: AnimationEditorInput, key: AnimationKeySource): boolean {
		return input.document?.syntaxComplete === true && key.source?.structural === true && key.coordinate !== undefined && readLuaNumberLiteral(key.coordinate.field.value) !== null
			&& !this.modelFor(input, key.source.file).readOnly && input.keys.range.maximum > input.keys.range.minimum;
	}

	public canAddTrack(input: AnimationEditorInput): boolean {
		const document = input.document;
		if (document?.syntaxComplete !== true) return false;
		const source = document.tracksSource;
		if (source !== undefined) return source.structural && source.array && !this.modelFor(input, source.file).readOnly;
		return document.root.structural && findNamedLuaTableField(document.root.table, 'tracks') === null
			&& !this.modelFor(input, document.root.file).readOnly;
	}
	public addTrack(input: AnimationEditorInput): void {
		const document = input.document!, source = document.tracksSource === undefined ? document.root : document.tracksSource;
		this.quickInput.pick('VALUE TRACK', 'Interpolation', (_origin, lifetime) => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(INTERPOLATIONS);
		}, item => {
			const prompt = this.quickInput.input('PROPERTY PATH', "Lua path, e.g. {'visual', 'offset_x'}", "{'x'}", async value => validateLuaTableFieldExpression(value), path => {
				const tangent = item.value === 'cubic' ? ', arrive_tangent = 0, leave_tangent = 0' : '';
				const track = `{ kind = 'value', interpolation = '${item.value}', path = ${path}, keys = { { time_ms = 0, value = 0${tangent} }, { time_ms = 100, value = 0${tangent} } } }`;
				this.modelFor(input, source.file).pushEditOperations(createLuaTableFieldInsertionEdits(this.modelFor(input, source.file).buffer,
					source.file.chunk, source.table, source.table.fields.length,
					document.tracksSource === undefined ? `tracks = { ${track} }` : track));
				this.refresh(input);
				this.selectTrack(input, input.document!.tracks.length);
			});
			prompt.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
		});
	}

	public canAddKey(input: AnimationEditorInput): boolean {
		const track = input.document?.tracks[input.trackIndex];
		return input.document?.syntaxComplete === true && track?.kind === 'value' && track.unit !== undefined && track.keysSource?.structural === true
			&& track.keysSource.array && !this.modelFor(input, track.keysSource.file).readOnly;
	}
	public addKey(input: AnimationEditorInput): void {
		const track = input.document!.tracks[input.trackIndex], source = track.keysSource!;
		const time = input.keys.cursor;
		const lifetime = this.quickInput.input('KEY VALUE', `${track.unit} = ${time}`, '0', async text => validateLuaTableFieldExpression(text), value => {
			const tangents = track.interpolation === 'cubic' ? ', arrive_tangent = 0, leave_tangent = 0' : '';
			this.modelFor(input, source.file).pushEditOperations(createLuaTableFieldInsertionEdits(this.modelFor(input, source.file).buffer,
				source.file.chunk, source.table, source.table.fields.length, `{ ${track.unit} = ${time}, value = ${value}${tangents} }`));
			this.refresh(input);
			this.selectKey(input, input.document!.tracks[input.trackIndex].keys.length - 1);
		});
		lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
	}
	public canRemove(input: AnimationEditorInput): boolean {
		const track = input.document?.tracks[input.trackIndex];
		const source = input.keyIndex >= 0 ? track?.keysSource : input.document?.tracksSource;
		return input.document?.syntaxComplete === true && track !== undefined && source?.structural === true && (input.keyIndex < 0 || track.kind !== 'value' || track.keys.length > 1)
			&& !this.modelFor(input, source.file).readOnly;
	}
	public remove(input: AnimationEditorInput): void {
		const track = input.document!.tracks[input.trackIndex];
		const key = track.keys[input.keyIndex];
		const source = input.keyIndex >= 0 ? track.keysSource! : input.document!.tracksSource!;
		const field = input.keyIndex >= 0 ? key.field : track.field;
		this.modelFor(input, source.file).pushEditOperations(createLuaTableFieldRemovalEdits(this.modelFor(input, source.file).buffer,
			source.file.chunk.locations, source.file.chunk.tokens, field));
	}
	public openSource(input: AnimationEditorInput): void {
		const track = input.document?.tracks[input.trackIndex], key = track?.keys[input.keyIndex];
		const property = input.details.rows[input.details.selectionIndex]?.element;
		const file = property?.source.file ?? key?.file ?? track?.file ?? input.document?.root.file;
		const span = property?.field.span ?? key?.field.span ?? track?.field.span ?? input.document?.root.table.span;
		const range = file === undefined || span === undefined ? undefined : file.chunk.locations.range(span);
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, file === undefined ? input.workingCopy.resource.path : file.file,
			range === undefined ? null : { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}

	public openProducerSource(input: AnimationEditorInput): void {
		const written = input.details.rows[input.details.selectionIndex].element.producer!.source;
		const range = written.file.chunk.locations.range(written.expression.span);
		this.navigation.focusChunkSourceForContext(input.workingCopy.resource.domain, written.file.file,
			{ row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}
}

const INTERPOLATIONS = [
	{ label: 'Linear', description: '', detail: 'Linear value segments', value: 'linear' },
	{ label: 'Cubic', description: '', detail: 'Hermite segments with arrive and leave tangents', value: 'cubic' },
	{ label: 'Step', description: '', detail: 'Discrete values, including image and sprite frame changes', value: 'step' },
];
