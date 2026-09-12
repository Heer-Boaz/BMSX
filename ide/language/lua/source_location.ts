import { resourceIdentityEquals } from '../../common/resource';
import type { EditorTextModel } from '../../editor/model/text_model';
import type { TrackedTextLocation } from '../../editor/text/text_location';
import type { LuaSourceRange } from '../../../toolchain/ts/lua/syntax/ast';
import { luaSourcePositionMatchesTextRange, luaSourcePositionToTextRange, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from './source_edits';

/** Paths have already been resolved in the language workspace's resource domain. */
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
