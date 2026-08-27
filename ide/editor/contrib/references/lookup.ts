import { buildEditorSemanticFrontend } from '../intellisense/frontend';
import { extractHoverExpressionFromBuffer } from '../intellisense/engine';
import type { ReferenceMatchInfo } from './state';
import type { TextBuffer } from '../../text/text_buffer';
import type { SearchMatch } from '../../../common/models';
import type { ResourceIdentity } from '../../../common/resource';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import { searchMatchFromSourceRange } from '../../navigation/source_range';

export type ReferenceLookupOptions = {
	buffer: TextBuffer;
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	identity: ResourceIdentity;
};

export type ReferenceLookupResult =
	| { kind: 'success'; info: ReferenceMatchInfo; initialIndex: number; }
	| { kind: 'error'; message: string; duration: number; };

export function resolveReferenceLookup(bridge: RuntimeLuaTooling, options: ReferenceLookupOptions): ReferenceLookupResult {
	const path = options.identity.path;
	const identifier = extractHoverExpressionFromBuffer(options.buffer, options.cursorRow, options.cursorColumn, path);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const frontend = buildEditorSemanticFrontend(bridge, options.identity, options.buffer, options.textVersion);
	const resolution = frontend.findReferencesByPosition(path, options.cursorRow + 1, options.cursorColumn + 1);
	if (!resolution) {
		return { kind: 'error', message: `Definition not found for ${identifier.expression}`, duration: 1.8 };
	}
	const matches: SearchMatch[] = [];
	const definitionKeys = new Array<SymbolID>(resolution.targets.length);
	for (let targetIndex = 0; targetIndex < resolution.targets.length; targetIndex += 1) {
		const target = resolution.targets[targetIndex];
		definitionKeys[targetIndex] = target.id;
		if (target.declaration.file === path) {
			const definitionMatch = searchMatchFromSourceRange(target.declaration.range);
			matches.push(definitionMatch);
		}
	}
	for (let index = 0; index < resolution.references.length; index += 1) {
		const reference = resolution.references[index];
		if (reference.file !== path) {
			continue;
		}
		const match = searchMatchFromSourceRange(reference.range);
		matches.push(match);
	}
	matches.sort((left, right) => left.row !== right.row ? left.row - right.row : left.start - right.start);
	let initialIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row === options.cursorRow && options.cursorColumn >= match.start && options.cursorColumn < match.end) {
			initialIndex = index;
			break;
		}
	}
	return {
		kind: 'success',
		info: {
			matches,
			expression: identifier.expression,
			definitionKeys,
			documentVersion: options.textVersion,
		},
		initialIndex,
	};
}
