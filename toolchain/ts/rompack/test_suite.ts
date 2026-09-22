import { LuaSyntaxError } from '../lua/errors';
import { toLuaModulePath } from '../lua/module_path';
import { findLuaModuleExport } from '../lua/semantic/module_bindings';
import { visitNamedTableFields } from '../lua/compiler/passes/expression_paths';
import { LuaSyntaxKind, type LuaChunk, type LuaExpression, type LuaSourceRange } from '../lua/syntax/ast';

export type GuestTestCase = {
	readonly name: string;
	readonly range: LuaSourceRange;
};

export type GuestTestSuite = {
	readonly modulePath: string;
	readonly sourcePath: string;
	readonly kind: 'unit' | 'integration';
	readonly setup: boolean;
	readonly teardown: boolean;
	readonly tests: readonly GuestTestCase[];
};

/** Source declarations, not runtime registration. Test bodies are never evaluated by discovery. */
export function discoverGuestTestSuite(chunk: LuaChunk, sourcePath: string): GuestTestSuite {
	const exported = findLuaModuleExport(chunk);
	const root = exported?.expressions[0];
	if (root === undefined || root.kind !== LuaSyntaxKind.TableConstructorExpression) {
		const range = chunk.locations.range(exported?.span ?? chunk.span);
		throw new LuaSyntaxError('A test module must return a suite table.', sourcePath, range.start.line, range.start.column);
	}
	const fields = new Map<string, { value: LuaExpression; range: LuaSourceRange }>();
	visitNamedTableFields(root, (name, value, field) => {
		const range = chunk.locations.range(field.span);
		if (fields.has(name)) {
			throw new LuaSyntaxError(`Duplicate suite field '${name}'.`, sourcePath, range.start.line, range.start.column);
		}
		if (name !== 'kind' && name !== 'tests' && name !== 'setup' && name !== 'teardown') {
			throw new LuaSyntaxError(`Unknown suite field '${name}'.`, sourcePath, range.start.line, range.start.column);
		}
		if ((name === 'setup' || name === 'teardown') && value.kind !== LuaSyntaxKind.FunctionExpression) {
			throw new LuaSyntaxError(`Suite '${name}' must declare a function.`, sourcePath, range.start.line, range.start.column);
		}
		fields.set(name, { value, range });
	});
	const range = chunk.locations.range(root.span);
	if (fields.size !== root.fields.length) {
		throw new LuaSyntaxError('Suite fields must have static string keys.', sourcePath, range.start.line, range.start.column);
	}
	const kind = fields.get('kind')?.value;
	if (kind?.kind !== LuaSyntaxKind.StringLiteralExpression || (kind.value !== 'unit' && kind.value !== 'integration')) {
		throw new LuaSyntaxError("Suite kind must be 'unit' or 'integration'.", sourcePath, range.start.line, range.start.column);
	}
	const declarations = fields.get('tests')?.value;
	if (declarations?.kind !== LuaSyntaxKind.TableConstructorExpression || declarations.fields.length === 0) {
		throw new LuaSyntaxError('A suite must declare a nonempty tests table.', sourcePath, range.start.line, range.start.column);
	}
	const tests: GuestTestCase[] = [];
	const names = new Set<string>();
	visitNamedTableFields(declarations, (name, value, field) => {
		const range = chunk.locations.range(field.span);
		if (names.has(name)) {
			throw new LuaSyntaxError(`Duplicate test '${name}'.`, sourcePath, range.start.line, range.start.column);
		}
		if (value.kind !== LuaSyntaxKind.FunctionExpression) {
			throw new LuaSyntaxError(`Test '${name}' must declare a function.`, sourcePath, range.start.line, range.start.column);
		}
		names.add(name);
		tests.push({ name, range });
	});
	if (tests.length !== declarations.fields.length) {
		const range = chunk.locations.range(declarations.span);
		throw new LuaSyntaxError('Tests must have static string names.', sourcePath, range.start.line, range.start.column);
	}
	return {
		modulePath: toLuaModulePath(sourcePath), sourcePath, kind: kind.value,
		setup: fields.has('setup'), teardown: fields.has('teardown'), tests,
	};
}
