import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { EditorNavigationController } from '../resources/navigation';
import { AnimationEditorInput, type AnimationSourceSelection } from './editor_input';
import { buildAnimationSourceDocument } from './source';
import { projectAnimationDetails } from './details';
import { animationDefinitionAtPosition, animationDefinitionAtRange, animationDefinitionFamily, collectAnimationDefinitions, type AnimationDefinitionSource } from './definitions';
import { AnimationAuthoring } from './authoring';
import { revealWorkbenchListSelection } from '../../ui/list_view';

/** Admits source generations, selects syntax and issues edits through their real working copies. */
export class AnimationEditorController {
	public readonly authoring: AnimationAuthoring;
	public constructor(private readonly catalog: WorkspaceSourceCatalog,
		private readonly navigation: EditorNavigationController, private readonly quickInput: QuickInputController) { this.authoring = new AnimationAuthoring(this, quickInput, catalog); }

	public open(group: EditorGroupView): void {
		const snapshots = new Map<string, LuaSemanticWorkspaceSnapshot>();
		const snapshotFor = (contextId: string): LuaSemanticWorkspaceSnapshot => {
			let snapshot = snapshots.get(contextId);
			if (snapshot === undefined) {
				const project = getOrCreateSemanticProject(editorTextModelService, contextId);
				project.synchronizeSources(this.catalog);
				snapshot = project.getSnapshot(); snapshots.set(contextId, snapshot);
			}
			return snapshot;
		};
		const active = group.model.activeTab;
		if (active?.kind === 'code_editor' && active.workingCopy.mode === 'lua') {
			const model = active.workingCopy, snapshot = snapshotFor(model.resource.contextId), file = snapshot.getFileData(resourceIdentityKey(model.resource))!;
			const table = animationDefinitionAtPosition(file, active.context.view.cursorRow + 1, active.context.view.cursorColumn + 1);
			if (table !== undefined) {
				const registered = collectAnimationDefinitions(model.resource, snapshot).find(item => item.table === table);
				this.openDefinition(group, model.resource.contextId, registered === undefined ? { file, table, label: `${model.resource.path}:${file.chunk.locations.range(table.span).start.line}` } : registered);
				return;
			}
			if (buildAnimationSourceDocument(model.resource, snapshot) !== undefined) { this.openResource(group, model.resource); return; }
		}
		this.quickInput.pick('ANIMATIONS', 'Choose a written definition', (_origin, lifetime) => {
			snapshots.clear();
			const choices: { label: string; description: string; detail: string; contextId: string; definition: AnimationDefinitionSource }[] = [];
			const admitted = new Map<string, Map<LuaTableConstructorExpression, Set<FileSemanticData | undefined>>>();
			for (const resource of this.catalog.luaResources) {
				let seen = admitted.get(resource.contextId);
				if (seen === undefined) { seen = new Map(); admitted.set(resource.contextId, seen); }
				for (const definition of collectAnimationDefinitions(resource, snapshotFor(resource.contextId))) {
					let consumers = seen.get(definition.table);
					if (consumers === undefined) { consumers = new Set(); seen.set(definition.table, consumers); }
					if (consumers.has(definition.consumer)) continue;
					consumers.add(definition.consumer);
					const range = definition.file.chunk.locations.range(definition.table.span);
					const owner = getOrCreateSemanticProject(editorTextModelService, resource.contextId).getResourceIdentity(definition.file.file);
					choices.push({ label: definition.label, description: definition.context === undefined ? owner.path : `${definition.context} / ${owner.path}`,
						detail: `${this.catalog.getContext(resource.contextId).projectRootPath} / ${range.start.line}:${range.start.column}`,
						contextId: resource.contextId, definition });
				}
			}
			const retire = () => this.quickInput.hide();
			lifetime.add({ dispose: editorTextModelService.onDidChangeContent(retire) });
			lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
			lifetime.add({ dispose: this.catalog.onDidChange(retire) });
			return new TextQuickPickProvider(choices);
		},
			item => this.openDefinition(group, item.contextId, item.definition),
			lifetime => lifetime.add({ dispose: group.onWillDispose(() => this.quickInput.hide()) }));
	}

	public openDefinition(group: EditorGroupView, contextId: string, definition: AnimationDefinitionSource): AnimationEditorInput {
		const project = getOrCreateSemanticProject(editorTextModelService, contextId);
		const resource = this.catalog.resolveResource(project.getResourceIdentity(definition.file.file))!;
		const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
		const range = definition.file.chunk.locations.range(definition.table.span);
		let input = group.model.tabs.find((item): item is AnimationEditorInput => item.kind === 'animation'
			&& item.projectContextId === contextId && item.workingCopy === model && item.consumerPath === definition.consumer?.file
			&& item.definitionRange !== undefined && luaSourceRangeMatchesTextRange(model.buffer, range, item.definitionRange));
		if (input === undefined) {
			input = new AnimationEditorInput(model, contextId, luaSourceRangeToTextRange(model.buffer, range), definition.label, definition.consumer?.file);
			if (definition.consumer !== undefined) {
				const consumer = this.catalog.resolveResource(project.getResourceIdentity(definition.consumer.file))!;
				input.sourceModels.set(definition.consumer.file, resolveLuaTextFileModel(editorTextModelService, this.catalog, consumer));
			}
			this.refresh(input);
		}
		group.openEditor(input);
		return input;
	}

	public openResource(group: EditorGroupView, resource: RuntimeResource): AnimationEditorInput {
		const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
		let input = group.model.tabs.find((item): item is AnimationEditorInput => item.kind === 'animation' && item.workingCopy === model && item.definitionRange === undefined);
		if (input === undefined) { input = new AnimationEditorInput(model, resource.contextId); this.refresh(input); }
		group.openEditor(input);
		return input;
	}

	public modelFor(input: AnimationEditorInput, file: FileSemanticData): EditorTextModel {
		let model = input.sourceModels.get(file.file);
		if (model === undefined) {
			const project = getOrCreateSemanticProject(editorTextModelService, input.projectContextId);
			const resource = this.catalog.resolveResource(project.getResourceIdentity(file.file))!;
			model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
			input.sourceModels.set(file.file, model);
		}
		return model;
	}


	public refresh(input: AnimationEditorInput): void {
		const project = getOrCreateSemanticProject(editorTextModelService, input.projectContextId);
		project.synchronizeSources(this.catalog);
		const snapshot = project.getSnapshot();
		if (snapshot.revision === input.sourceRevision) {
			input.framePreview.update(input.framesSelected ? input.document : undefined, input.details.selectionIndex, input.projectContextId, this.catalog);
			return;
		}
		input.invalidateProjection();
		input.sourceRevision = snapshot.revision;
		const definition = input.definitionRange === undefined ? undefined
			: animationDefinitionAtRange(snapshot.getFileData(resourceIdentityKey(input.workingCopy.resource))!, input.workingCopy.buffer, input.definitionRange);
		input.document = input.definitionRange !== undefined && definition === undefined ? undefined
			: buildAnimationSourceDocument(input.workingCopy.resource, snapshot, definition);
		if (input.document !== undefined) {
			const family = animationDefinitionFamily(input.document.reader, snapshot.getFileData(input.consumerPath ?? resourceIdentityKey(input.workingCopy.resource))!, input.document.root);
			if (family !== input.document.family) input.document = { ...input.document, family };
		}
		input.tracks.rows.length = 0;
		input.trackIndex = -1; input.keyIndex = -1; input.clipIndex = -1; input.framesSelected = false;
		const document = input.document;
		if (document !== undefined) {
			this.modelFor(input, document.root.file);
			input.tracks.rows.push({ track: undefined, clip: undefined, frames: false, label: 'Animation', text: '' });
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
				input.tracks.rows.push({ track, clip: undefined, frames: false, label: track.label, text: '' });
			}
			if (document.clipsSource !== undefined) this.modelFor(input, document.clipsSource.file);
			for (let index = 0; index < document.clips.length; index++) {
				const clip = document.clips[index];
				if (this.matches(input.trackSelection, this.modelFor(input, clip.file), clip.file, clip.field)) input.clipIndex = index;
				if (clip.source !== undefined) this.modelFor(input, clip.source.file);
				if (clip.sequence !== undefined) this.modelFor(input, clip.sequence.file);
				input.tracks.rows.push({ track: undefined, clip, frames: false, label: clip.label, text: '' });
			}
			if (document.framesField !== undefined) {
				input.framesSelected = this.matches(input.trackSelection, this.modelFor(input, document.root.file), document.root.file, document.framesField);
				if (document.framesSource !== undefined) this.modelFor(input, document.framesSource.file);
				input.tracks.rows.push({ track: undefined, clip: undefined, frames: true, label: 'Frames', text: '' });
			}
		}
		if (input.trackIndex === -1 && input.clipIndex === -1 && !input.framesSelected) input.trackSelection = undefined;
		if (input.keyIndex === -1) input.keySelection = undefined;
		input.tracks.selectionIndex = document === undefined ? -1 : input.framesSelected ? input.tracks.rows.length - 1 : input.clipIndex >= 0 ? document.tracks.length + 1 + input.clipIndex : input.trackIndex + 1;
		this.refreshDetails(input, true);
		const track = document?.tracks[input.trackIndex];
		const unit = track !== undefined ? track.unit : input.clipIndex >= 0 ? 'time_ms' : input.framesSelected ? 'frame'
			: document?.tracks.find(track => track.unit !== undefined)?.unit ?? (document !== undefined && document.clips.length > 0 ? 'time_ms' : document?.framesSource?.array ? 'frame' : undefined);
		input.keys.bind(track, input.keyIndex, document, unit);
		input.status = document === undefined ? 'Definition unavailable' : !document.syntaxComplete ? 'Incomplete source' : 'Authored Lua';
		input.framePreview.update(input.framesSelected ? document : undefined, input.details.selectionIndex, input.projectContextId, this.catalog);
		input.version += 1;
	}

	private matches(selection: AnimationSourceSelection | undefined, model: EditorTextModel, file: FileSemanticData, field: LuaTableField): boolean {
		return selection !== undefined && selection.path === file.file
			&& luaSourceRangeMatchesTextRange(model.buffer, file.chunk.locations.range(field.span), selection.range);
	}

	public selectTrack(input: AnimationEditorInput, rowIndex: number): void {
		const row = input.tracks.rows[rowIndex], track = row.track, clip = row.clip, document = input.document!;
		input.trackIndex = track === undefined ? -1 : rowIndex - 1;
		input.clipIndex = clip === undefined ? -1 : rowIndex - document.tracks.length - 1;
		input.framesSelected = row.frames;
		input.tracks.selectionIndex = rowIndex;
		const selection = track ?? clip;
		const file = row.frames ? document.root.file : selection?.file;
		const field = row.frames ? document.framesField : selection?.field;
		input.trackSelection = file === undefined ? undefined : { path: file.file,
			range: luaSourceRangeToTextRange(this.modelFor(input, file).buffer, file.chunk.locations.range(field!.span)) };
		input.keySelection = undefined; input.keyIndex = -1;
		input.keys.bind(track, -1, input.document, clip !== undefined ? 'time_ms' : row.frames ? 'frame' : track === undefined ? input.keys.unit : track.unit);
		this.refreshDetails(input);
		revealWorkbenchListSelection(input.tracks);
	}

	public selectKey(input: AnimationEditorInput, index: number): void {
		const key = input.document!.tracks[input.trackIndex].keys[index];
		input.keyIndex = index;
		input.keySelection = index < 0 ? undefined : { path: key.file.file,
			range: luaSourceRangeToTextRange(this.modelFor(input, key.file).buffer, key.file.chunk.locations.range(key.field.span)) };
		input.keys.select(index);
		const position = input.keys.positions[index];
		if (position !== undefined && position !== null) input.keys.reveal(position);
		this.refreshDetails(input);
	}
	public selectProperty(input: AnimationEditorInput, index: number): void {
		input.details.selectionIndex = index;
		const property = input.details.rows[index]?.element;
		input.detailSelection = property === undefined ? undefined : { path: property.source.file.file,
			range: luaSourceRangeToTextRange(this.modelFor(input, property.source.file).buffer, property.source.file.chunk.locations.range(property.field.span)) };
		revealWorkbenchListSelection(input.details);
	}

	private refreshDetails(input: AnimationEditorInput, retainSelection = false): void {
		const document = input.document;
		const track = document?.tracks[input.trackIndex];
		const source = input.framesSelected ? document?.framesSource : input.clipIndex >= 0 ? document?.clips[input.clipIndex].source
			: input.keyIndex >= 0 ? track!.keys[input.keyIndex].source : input.trackIndex >= 0 ? track?.source : document?.root;
		input.selectedSource = source;
		const excluded: string[] = [];
		if (input.keyIndex < 0) {
			if (input.trackIndex >= 0) {
				if (track?.keysSource?.structural === true && track.keysSource.array) excluded.push('keys');
			} else if (input.clipIndex < 0 && !input.framesSelected) {
				if (document?.tracksSource?.array) excluded.push('tracks');
				if (document?.clipsSource?.array) excluded.push('subsequences');
				if (document?.framesSource?.array) excluded.push('frames');
			}
		}
		projectAnimationDetails(input.details, input.framesSelected && source === undefined ? document?.root : source, file => this.modelFor(input, file), document?.reader, excluded);
		if (retainSelection) {
			for (let index = 0; index < input.details.rows.length; index++) {
				const property = input.details.rows[index].element;
				if (this.matches(input.detailSelection, this.modelFor(input, property.source.file), property.source.file, property.field)) { input.details.selectionIndex = index; break; }
			}
			if (input.details.selectionIndex < 0) input.detailSelection = undefined;
		} else input.detailSelection = undefined;
		input.publishModels();
	}

	public openSource(group: EditorGroupView, input: AnimationEditorInput): void {
		const track = input.document?.tracks[input.trackIndex], key = track?.keys[input.keyIndex], clip = input.document?.clips[input.clipIndex];
		const property = input.details.rows[input.details.selectionIndex]?.element;
		const file = property?.source.file ?? key?.file ?? track?.file ?? clip?.file ?? input.document?.root.file;
		const span = property?.field.span ?? key?.field.span ?? track?.field.span ?? clip?.field.span ?? input.document?.root.table.span;
		const range = file === undefined || span === undefined ? undefined : file.chunk.locations.range(span);
		this.navigation.focusChunkSource(group, file === undefined ? input.workingCopy.resource : this.modelFor(input, file).resource,
			range === undefined ? undefined : { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}
	public openClip(group: EditorGroupView, input: AnimationEditorInput): void {
		const source = input.document!.clips[input.clipIndex].sequence!;
		this.openDefinition(group, input.projectContextId, { file: source.file, table: source.table, label: input.document!.clips[input.clipIndex].label });
	}

	public openProducerSource(group: EditorGroupView, input: AnimationEditorInput): void {
		const written = input.details.rows[input.details.selectionIndex].element.producer!.source;
		const range = written.file.chunk.locations.range(written.expression.span);
		this.navigation.focusChunkSource(group, this.modelFor(input, written.file).resource,
			{ row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}
}
