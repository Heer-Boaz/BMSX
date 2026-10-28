import type { LuaFileSemanticRevision } from '../../../toolchain/ts/lua/semantic/model';
import type { EditorLuaSemanticProject } from '../../editor/contrib/intellisense/semantic/workspace/project';
import type { EditorSourceLocation } from '../../editor/navigation/source_location';
import { resourceIdentityEquals } from '../../common/resource';
import type { EditorTextModel } from '../../editor/model/text_model';
import type { TrackedTextLocation } from '../../editor/text/text_location';
import type { LuaSourceRange } from '../../../toolchain/ts/lua/syntax/ast';
import { luaSourcePositionMatchesTextRange, luaSourcePositionToTextRange, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from './source_edits';

/** Opaque semantic file addresses resolve to their retained working copies. */
export type LuaSourceModels = ReadonlyMap<string, EditorTextModel>;

export function luaSourceRangeToTextLocation(models: LuaSourceModels, range: LuaSourceRange): TrackedTextLocation {
	const model = models.get(range.path)!;
	return { resource: model.identity, ...luaSourceRangeToTextRange(model.buffer, range) };
}

export function luaSourceStartToTextLocation(models: LuaSourceModels, range: LuaSourceRange): TrackedTextLocation {
	const model = models.get(range.path)!;
	return { resource: model.identity, ...luaSourcePositionToTextRange(model.buffer, range.start) };
}

export function luaSourceRangeMatchesTextLocation(models: LuaSourceModels, range: LuaSourceRange, location: TrackedTextLocation): boolean {
	const model = models.get(range.path)!;
	return resourceIdentityEquals(model.identity, location.resource) && luaSourceRangeMatchesTextRange(model.buffer, range, location);
}

export function luaSourceStartMatchesTextLocation(models: LuaSourceModels, range: LuaSourceRange, location: TrackedTextLocation): boolean {
	const model = models.get(range.path)!;
	return resourceIdentityEquals(model.identity, location.resource) && luaSourcePositionMatchesTextRange(model.buffer, range.start, location);
}

/** Dependency admission may publish edits after an immutable Lua snapshot was read. */
export function luaSourceLocation(project: EditorLuaSemanticProject, model: EditorTextModel, file: LuaFileSemanticRevision,
	range?: LuaSourceRange): EditorSourceLocation | undefined {
	if (project.isDisposed) return undefined;
	const current = project.getFileData(model.identity);
	if (project.isDisposed || current?.revision !== file.revision) return undefined;
	return { model, modelVersion: model.version, selection: range === undefined ? undefined : {
		row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1,
	} };
}
