import {
	buildLuaSemanticFrontendFromSnapshot,
	type LuaSemanticPositionTarget,
} from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace, type FileSemanticData, type LuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { findLuaSemanticOccurrenceAt } from '../../toolchain/ts/lua/semantic/position_query';

/** Retain the fixture's binder identities, including recovered syntax, in a real workspace. */
export function semanticSnapshot(...files: readonly FileSemanticData[]): LuaSemanticWorkspaceSnapshot {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles(files);
	return workspace.getSnapshot();
}

const frontends = new WeakMap<
	LuaSemanticWorkspaceSnapshot,
	ReturnType<typeof buildLuaSemanticFrontendFromSnapshot>
>();
const EMPTY_POSITION_TARGETS: readonly LuaSemanticPositionTarget[] = [];

function semanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof buildLuaSemanticFrontendFromSnapshot> {
	let frontend = frontends.get(snapshot);
	if (!frontend) {
		frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
		frontends.set(snapshot, frontend);
	}
	return frontend;
}

export function semanticSymbolsAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): readonly LuaSemanticPositionTarget[] {
	const symbols = semanticFrontend(snapshot).findSymbolsByPosition(path, line, column);
	return symbols ? symbols.targets : EMPTY_POSITION_TARGETS;
}

export function semanticSymbolAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): LuaSemanticPositionTarget | null {
	const targets = semanticSymbolsAt(snapshot, path, line, column);
	return targets.length === 1 ? targets[0] : null;
}

/** The may-call solver's targets at a position, for whole-program specification tests. */
export function wholeProgramSymbolsAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): readonly LuaSemanticPositionTarget[] {
	const file = snapshot.getFileData(path);
	const occurrence = file === undefined ? null : findLuaSemanticOccurrenceAt(file, line, column);
	if (occurrence === null) return EMPTY_POSITION_TARGETS;
	if (occurrence.kind === 'declaration') return [{ id: occurrence.declaration.id, declaration: occurrence.declaration,
		range: file!.chunk.locations.range(occurrence.declaration.span) }];
	const resolver = snapshot.symbolResolver;
	return resolver.resolveWholeProgramReferenceTargets(occurrence.reference)
		.map(id => {
			const declaration = resolver.getDeclaration(id);
			return { id, declaration, range: snapshot.getFileData(declaration.file)!.chunk.locations.range(declaration.span) };
		});
}

export function wholeProgramSymbolAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): LuaSemanticPositionTarget | null {
	const targets = wholeProgramSymbolsAt(snapshot, path, line, column);
	return targets.length === 1 ? targets[0] : null;
}

// Compare public answers rather than cross-generation identity. Future stable
// symbol IDs need not match a separately constructed workspace's IDs.
export function semanticAnswers(snapshot: LuaSemanticWorkspaceSnapshot) {
	const resolver = snapshot.symbolResolver;
	return snapshot.files.map(file => ({
		file: file.file,
		scopes: file.scopes.map(scope => ({
			kind: scope.kind,
			start: file.chunk.locations.position(scope.startInclusive.unit, scope.startInclusive.offset),
			end: file.chunk.locations.position(scope.endExclusive.unit, scope.endExclusive.offset),
			parent: file.scopes.findIndex(parent => parent.id === file.scopeParents.get(scope.id)),
			declarations: scope.declarations.map(decl => file.decls.indexOf(decl)),
		})),
		declarations: file.decls.map(decl => ({
			name: decl.namePath, range: file.chunk.locations.range(decl.span),
			visibleFrom: file.chunk.locations.position(decl.visibleFrom.unit, decl.visibleFrom.offset),
		})),
		refs: file.refs.map(ref => ({
			name: ref.name,
			range: file.chunk.locations.range(ref.span),
			targets: resolver.resolveReferenceTargets(ref).map(id => {
				const decl = resolver.getDeclaration(id);
				return { file: decl.file, name: decl.namePath, range: file.chunk.locations.range(decl.span), signatures: resolver.getFunctionSignatures(id) };
			}),
		})),
	}));
}
