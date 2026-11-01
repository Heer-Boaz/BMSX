import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { CallValueEntry } from '../../../../toolchain/ts/lua/semantic/value_graph';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';

export type SceneFontSource = {
	readonly glyphs: ReadonlyMap<number, string>;
	readonly advancePadding: number;
	/** Absent definitions derive this from A, a, or ? at asset admission. */
	readonly lineHeight: number | undefined;
};

const FONT_DEFINE: LuaModuleImportTarget = { module: 'cartlib/font', memberPath: ['define'] };
const FONT_GET: LuaModuleImportTarget = { module: 'cartlib/font', memberPath: ['get'] };
const CATALOG_GET: LuaModuleImportTarget = { module: 'cartlib/text/font_catalog', memberPath: ['get'] };
const CATALOG_REPLACE: LuaModuleImportTarget = { module: 'cartlib/text/font_catalog', memberPath: ['replace'] };

/** One immutable source generation of font registrations. Font definitions are
 * retained separately from text layout; this never executes a getter or guesses
 * the contents of a computed glyph table. */
export class SceneFontSources {
	private definitions: ReadonlyMap<string, LuaWrittenExpression | undefined> | undefined;
	private unknownRegistration = false;
	private readonly fonts = new Map<string, SceneFontSource | undefined>();
	private readonly defaults = new WeakMap<FileSemanticData, SceneFontSource | undefined>();
	private readonly resolved = new WeakMap<LuaWrittenExpression, SceneFontSource | undefined>();
	private readonly forwarding = new WeakMap<FileSemanticData, CallValueEntry | undefined>();
	public constructor(public readonly reader: LuaSourceReader) {}

	/** Null proves nil/absence and selects the actual default identity. An
	 * unresolved font value never authorizes that default. */
	public resolve(file: FileSemanticData, source: LuaWrittenExpression | null | undefined): SceneFontSource | undefined {
		if (source === undefined) return;
		const implicit = source === null || source.expression.kind === LuaSyntaxKind.NilLiteralExpression;
		if (implicit) {
			if (this.defaults.has(file)) return this.defaults.get(file);
		} else {
			if (this.resolved.has(source)) return this.resolved.get(source);
			this.resolved.set(source, undefined);
		}
		let owner = file, api = CATALOG_GET;
		let id: string;
		let callee: LuaExpression | undefined;
		if (implicit) id = 'default';
		else {
			const call = this.reader.call(source.file, source.expression);
			if (call === undefined || call.expression.method !== null) return;
			owner = this.reader.snapshot.getFileData(call.file)!;
			const target = getLuaModuleAliasTarget(owner, call.callee), imports = this.reader.snapshot.symbolResolver.moduleImports;
			const selected = target !== null && imports.matchesImport(target, FONT_GET) ? FONT_GET
				: target !== null && imports.matchesImport(target, CATALOG_GET) ? CATALOG_GET : undefined;
			if (selected === undefined) return;
			const argument = call.expression.arguments[0];
			const identity = argument === undefined ? undefined : this.reader.stringValue(owner, argument);
			if (identity === undefined) return;
			api = selected; id = identity; callee = call.expression.callee;
		}
		const module = this.reader.module(owner, api.module);
		const getter = module === undefined ? undefined : this.reader.member(module.file, module.expression, 'get');
		const font = getter?.expression.kind === LuaSyntaxKind.FunctionExpression
			&& (callee === undefined || this.reader.callable(owner, callee) === getter) ? this.font(id) : undefined;
		if (implicit) this.defaults.set(file, font);
		else this.resolved.set(source, font);
		return font;
	}

	private font(id: string): SceneFontSource | undefined {
		if (this.fonts.has(id)) return this.fonts.get(id);
		this.index();
		let font: SceneFontSource | undefined;
		if (!this.unknownRegistration) {
			if (this.definitions!.has(id)) {
				const definition = this.definitions!.get(id);
				if (definition !== undefined) font = this.definition(definition);
			} else if (id === 'default') {
				const glyphs = new Map<number, string>();
				for (let codepoint = 0x20; codepoint <= 0x7e; codepoint += 1)
					glyphs.set(codepoint, `tiny_3b_font_code_0x${codepoint.toString(16)}`);
				font = { glyphs, advancePadding: 0, lineHeight: 6 };
			}
		}
		this.fonts.set(id, font);
		return font;
	}

	private index(): void {
		if (this.definitions !== undefined) return;
		const definitions = new Map<string, LuaWrittenExpression | undefined>(), reader = this.reader;
		for (const file of reader.snapshot.files) for (const call of file.callSites) {
			if (call.expression.method !== null) continue;
			const target = getLuaModuleAliasTarget(file, call.call.callee);
			if (target === null) continue;
			const imports = reader.snapshot.symbolResolver.moduleImports;
			const api = imports.matchesImport(target, FONT_DEFINE) ? FONT_DEFINE
				: imports.matchesImport(target, CATALOG_REPLACE) ? CATALOG_REPLACE : undefined;
			if (api === undefined) continue;
			const module = reader.module(file, api.module);
			const constructor = module === undefined ? undefined : reader.member(module.file, module.expression, api.memberPath[0]);
			const callable = constructor?.expression.kind === LuaSyntaxKind.FunctionExpression
				&& reader.callable(file, call.expression.callee) === constructor;
			if (api === CATALOG_REPLACE && callable && this.forwardingApplication(file) === call.call) continue;
			const argument = call.expression.arguments[0];
			const id = argument === undefined ? undefined : reader.stringValue(file, argument);
			const definitionArgument = call.expression.arguments[1];
			const definition = callable && definitionArgument !== undefined
				? reader.expression(file, definitionArgument) : undefined;
			if (id === undefined) this.unknownRegistration = true;
			else definitions.set(id, definitions.has(id) ? undefined : definition);
		}
		this.definitions = definitions;
	}

	/** font.define contributes the caller's registration, not another unknown
	 * registration from its formal parameters. Admit only its own single exact
	 * forwarding application; other calls in the same source remain writes. */
	private forwardingApplication(file: FileSemanticData): CallValueEntry | undefined {
		if (this.forwarding.has(file)) return this.forwarding.get(file);
		this.forwarding.set(file, undefined);
		const reader = this.reader, module = reader.module(file, FONT_DEFINE.module);
		const define = module === undefined ? undefined : reader.member(module.file, module.expression, 'define');
		if (define?.expression.kind !== LuaSyntaxKind.FunctionExpression || define.file !== file) return;
		const expression = define.expression;
		if (expression.hasVararg || expression.parameters.length !== 2) return;
		const flow = file.functionValueFlows.find(candidate => candidate.expression === expression);
		if (flow === undefined || flow.implicitReceiver) return;
		const id = file.declarationIdsBySyntax.get(expression.parameters[0])!;
		const definition = file.declarationIdsBySyntax.get(expression.parameters[1])!;
		if (file.declarationValuesByDeclaration.has(id) || file.declarationValuesByDeclaration.has(definition)
			|| flow.members.some(write => write.owner.root.kind === 'declaration'
				&& (write.owner.root.declId === id || write.owner.root.declId === definition))
			|| flow.assignments.some(write => write.target.root.kind === 'declaration'
				&& (write.target.root.declId === id || write.target.root.declId === definition))) return;
		let forwarding: CallValueEntry | undefined;
		for (const call of flow.calls) {
			if (call.expression.method !== null || call.arguments.length !== 2) continue;
			const target = getLuaModuleAliasTarget(file, call.callee);
			if (target === null || !reader.snapshot.symbolResolver.moduleImports.matchesImport(target, CATALOG_REPLACE)) continue;
			const first = call.arguments[0], second = call.arguments[1];
			if (first.root.kind !== 'declaration' || first.root.declId !== id || first.steps.length !== 0
				|| second.root.kind !== 'declaration' || second.root.declId !== definition || second.steps.length !== 0) continue;
			if (forwarding !== undefined) return;
			forwarding = call;
		}
		this.forwarding.set(file, forwarding);
		return forwarding;
	}

	private definition(source: LuaWrittenExpression): SceneFontSource | undefined {
		if (source.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
		const reader = this.reader, glyphSource = reader.member(source.file, source.expression, 'glyphs');
		if (glyphSource?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
			|| reader.snapshot.symbolResolver.authoredSources.tableMutations().has(glyphSource.expression)) return;
		const entries = new Map<string, string>();
		for (const field of glyphSource.expression.fields) {
			if (field.kind === LuaTableFieldKind.Array) return;
			const key = field.kind === LuaTableFieldKind.IdentifierKey ? field.name : reader.stringValue(glyphSource.file, field.key);
			const image = reader.stringValue(glyphSource.file, field.value);
			if (key === undefined || key.length === 0 || image === undefined) return;
			entries.set(key, image);
		}
		const glyphs = new Map<number, string>();
		for (const [key, image] of entries) {
			// Literal table writes settle before pairs visits the final keys.
			// Different keys sharing a first codepoint need the same image;
			// otherwise their pairs order has no proved winner.
			const codepoint = key.codePointAt(0)!;
			if (glyphs.has(codepoint) && glyphs.get(codepoint) !== image) return;
			glyphs.set(codepoint, image);
		}
		const padding = reader.memberState(source.file, source.expression, 'advance_padding');
		const paddingTruth = readLuaSourceTruth(padding);
		const advancePadding = paddingTruth === false ? 0
			: paddingTruth === true ? reader.numberValue(padding!.file, padding!.expression) : undefined;
		if (advancePadding === undefined) return;
		const height = reader.memberState(source.file, source.expression, 'line_height'), heightTruth = readLuaSourceTruth(height);
		if (heightTruth === undefined) return;
		const lineHeight = heightTruth === false ? undefined : reader.numberValue(height!.file, height!.expression);
		if (heightTruth && lineHeight === undefined) return;
		return { glyphs, advancePadding, lineHeight };
	}
}
