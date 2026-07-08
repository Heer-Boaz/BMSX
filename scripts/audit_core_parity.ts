import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Category = 'core' | 'host' | 'ide' | 'terminal' | 'language' | 'compiler_tooling' | 'rompacker_tooling' | 'cpu_interpreter_exception' | 'barrel';
type ManifestPattern = { pattern: string; category: Category; reason: string };
type StrictRuntimeSymbolParityEntry = { ts: string; cpp: string[]; reason: string };
type StrictRuntimeShapeParityEntry = { ts: string; cpp: string[]; symbols: string[]; reason: string };
type StrictRuntimeMethodExclusion = { name: string; reason: string };
type StrictRuntimeMethodParityEntry = {
	ts: string;
	cpp: string[];
	methods?: string[];
	compare_public?: boolean;
	ts_exclusions?: StrictRuntimeMethodExclusion[];
	cpp_exclusions?: StrictRuntimeMethodExclusion[];
	reason: string;
};
type StrictRuntimeNoChurnEntry = { files: string[]; reason: string };
type StrictRuntimeNoChurnRegionEntry = { file: string; start: string; end: string; reason: string };
type StrictRuntimeNoHeapRegionEntry = { file: string; start: string; end: string; reason: string };
type StrictRuntimeNoHeapFunctionEntry = { file: string; functions: string[]; reason: string };
type StrictLuaNoHeapRegionEntry = { file: string; start: string; end: string; reason: string };
type StrictRpuTableParityEntry = { ts: string; cpp: string; tables: string[]; reason: string };
type StrictShaderParityEntry = { webgl: string; gles2: string; reason: string };
type StrictLuaVdpAbiParitySymbol = { lua: string; ts: string };
type StrictLuaVdpAbiParityEntry = { lua: string; ts: string[]; symbols: StrictLuaVdpAbiParitySymbol[]; reason: string };
type StrictFileLayoutEntry = { present?: string[]; absent?: string[]; reason: string };
type StrictFilePairParityEntry = { ts: string; cpp: string[]; reason: string };
type StrictSaveStateSchemaParityEntry = { ts: string; cpp: string; symbol: string; reason: string };
type CppMissingTsExclusion = { cpp: string; reason: string };
type StrictRuntimeSymbols = { constants: Map<string, string>; constantValues: Map<string, string>; functions: Map<string, string[]> };
type Manifest = {
	patterns: ManifestPattern[];
	core_roots?: string[];
	must_have_cpp?: string[];
	strict_runtime_symbol_parity?: StrictRuntimeSymbolParityEntry[];
	strict_runtime_shape_parity?: StrictRuntimeShapeParityEntry[];
	strict_runtime_method_parity?: StrictRuntimeMethodParityEntry[];
	strict_runtime_no_churn?: StrictRuntimeNoChurnEntry[];
	strict_runtime_no_churn_regions?: StrictRuntimeNoChurnRegionEntry[];
	strict_runtime_no_heap_regions?: StrictRuntimeNoHeapRegionEntry[];
	strict_runtime_no_heap_functions?: StrictRuntimeNoHeapFunctionEntry[];
	strict_lua_no_heap_regions?: StrictLuaNoHeapRegionEntry[];
	strict_rpu_table_parity?: StrictRpuTableParityEntry[];
	strict_shader_parity?: StrictShaderParityEntry[];
	strict_lua_vdp_abi_parity?: StrictLuaVdpAbiParityEntry[];
	strict_file_layout?: StrictFileLayoutEntry[];
	strict_file_pair_parity?: StrictFilePairParityEntry[];
	strict_save_state_schema_parity?: StrictSaveStateSchemaParityEntry[];
	cpp_missing_ts_exclusions?: CppMissingTsExclusion[];
};

type ClassifiedFile = { file: string; category: Category; reason: string };

const repoRoot = process.cwd();
const sourceRoot = 'machine/ts';
const cppRoot = 'machine/cpp';
const manifestPath = 'scripts/core_parity_manifest.json';

function repoPath(value: string): string {
	const relative = path.relative(repoRoot, value);
	return relative.split(path.sep).join('/');
}

function readJsonManifest(): Manifest {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as Manifest;
}

function patternToRegExp(pattern: string): RegExp {
	let out = '^';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		const next = pattern[index + 1];
		if (char === '*' && next === '*') {
			out += '.*';
			index += 1;
		} else if (char === '*') {
			out += '[^/]*';
		} else if ('\\^$+?.()|{}[]'.includes(char)) {
			out += '\\' + char;
		} else {
			out += char;
		}
	}
	out += '$';
	return new RegExp(out);
}

const patternCache = new Map<string, RegExp>();
function matchesPattern(file: string, pattern: string): boolean {
	let compiled = patternCache.get(pattern);
	if (!compiled) {
		compiled = patternToRegExp(pattern);
		patternCache.set(pattern, compiled);
	}
	return compiled.test(file);
}

function patternSpecificity(pattern: string): number {
	let score = 0;
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			score -= pattern[index + 1] === '*' ? 2 : 1;
			if (pattern[index + 1] === '*') index += 1;
		} else {
			score += 2;
		}
	}
	return score;
}

function matchPattern(file: string, patterns: readonly ManifestPattern[]): ManifestPattern | null {
	let best: ManifestPattern | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const entry of patterns) {
		if (!matchesPattern(file, entry.pattern)) continue;
		const score = patternSpecificity(entry.pattern);
		if (score > bestScore) {
			best = entry;
			bestScore = score;
		}
	}
	return best;
}

function listTsFiles(dir: string, out: string[]): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listTsFiles(full, out);
		} else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
			out.push(repoPath(full));
		}
	}
}

function listCppMachineFiles(dir: string, out: string[]): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listCppMachineFiles(full, out);
		} else if (entry.isFile() && (entry.name.endsWith('.h') || entry.name.endsWith('.cpp'))) {
			out.push(repoPath(full));
		}
	}
}

function tsEquivalentForCppMachineFile(file: string): string {
	const relative = file.slice(`${cppRoot}/`.length);
	return `${sourceRoot}/${relative.replace(/\.(?:h|cpp)$/, '.ts')}`;
}

function resolveImport(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith('.')) return null;
	const baseDir = path.dirname(path.join(repoRoot, fromFile));
	const resolved = path.resolve(baseDir, specifier);
	const candidates = [
		resolved + '.ts',
		path.join(resolved, 'index.ts'),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return repoPath(candidate);
	}
	return null;
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
	const clause = node.importClause;
	if (!clause) return false;
	if (clause.isTypeOnly) return true;
	if (clause.name) return false;
	const named = clause.namedBindings;
	if (!named) return false;
	if (ts.isNamespaceImport(named)) return false;
	return named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
	if (node.isTypeOnly) return true;
	const clause = node.exportClause;
	if (!clause || !ts.isNamedExports(clause)) return false;
	return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function buildImportGraph(files: string[]): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	for (const file of files) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const imports: string[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
				if (!importDeclarationIsTypeOnly(node)) {
					const resolved = resolveImport(file, node.moduleSpecifier.text);
					if (resolved) imports.push(resolved);
				}
			} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
				if (!exportDeclarationIsTypeOnly(node)) {
					const resolved = resolveImport(file, node.moduleSpecifier.text);
					if (resolved) imports.push(resolved);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		graph.set(file, imports);
	}
	return graph;
}

function isBarrelFile(file: string): boolean {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
			continue;
		}
		return false;
	}
	return true;
}

function isExplicitNonCore(file: string, manifest: Manifest): boolean {
	const match = matchPattern(file, manifest.patterns);
	return match !== null && match.category !== 'core';
}


function manifestCoreScopeConflicts(manifest: Manifest): string[] {
	const conflicts: string[] = [];
	if (manifest.core_roots) {
		for (const file of manifest.core_roots) {
			const explicit = matchPattern(file, manifest.patterns);
			if (explicit && explicit.category !== 'core') {
				conflicts.push(`core_roots contains non-core file ${file} (${explicit.category}: ${explicit.reason})`);
			}
		}
	}
	if (manifest.must_have_cpp) {
		for (const file of manifest.must_have_cpp) {
			const explicit = matchPattern(file, manifest.patterns);
			if (explicit && explicit.category !== 'core') {
				conflicts.push(`must_have_cpp contains non-core file ${file} (${explicit.category}: ${explicit.reason})`);
			}
		}
	}
	return conflicts;
}

function collectCoreReachable(manifest: Manifest, graph: Map<string, string[]>): Set<string> {
	const core = new Set<string>();
	const stack: string[] = [];
	if (manifest.core_roots) {
		for (const file of manifest.core_roots) {
			if (isExplicitNonCore(file, manifest)) continue;
			core.add(file);
			stack.push(file);
		}
	}
	if (manifest.must_have_cpp) {
		for (const file of manifest.must_have_cpp) {
			if (isExplicitNonCore(file, manifest)) continue;
			core.add(file);
			stack.push(file);
		}
	}
	while (stack.length > 0) {
		const file = stack.pop()!;
		if (!graph.has(file)) continue;
		for (const imported of graph.get(file)!) {
			if (core.has(imported)) continue;
			if (isExplicitNonCore(imported, manifest)) continue;
			core.add(imported);
			stack.push(imported);
		}
	}
	return core;
}

function equivalentPaths(tsFile: string): string[] {
	const relative = tsFile.slice(sourceRoot.length + 1, -'.ts'.length);
	return [
		`${cppRoot}/${relative}.h`,
		`${cppRoot}/${relative}.cpp`,
	];
}

function cppFileHasLogic(file: string): boolean {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	// disable-next-line newline_normalization_pattern -- C++ source text analysis splits lines at the scanner boundary.
	const stripped = text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.map((line) => line.replace(/\/\/.*$/, '').trim())
		.filter((line) => line.length > 0)
		.filter((line) => !line.startsWith('#'))
		.filter((line) => line !== '{' && line !== '}')
		.filter((line) => !line.startsWith('namespace ') && !line.startsWith('} // namespace'));
	return cppFileHasStringTableDefinition(stripped) || stripped.some(cppLineHasLogic);
}

function cppLineHasLogic(line: string): boolean {
	return /\b(class|struct|enum|template|constexpr|inline|return|for|while|switch|if)\b/.test(line)
		|| /^(?:[\w:<>,*&]+\s+)+[\w:~]+\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[\w:<>,*&\s]+)?\{?$/.test(line);
}

function cppFileHasStringTableDefinition(lines: string[]): boolean {
	let insideStringTable = false;
	let hasStringEntry = false;
	for (const line of lines) {
		if (!insideStringTable) {
			insideStringTable = /^const\s+std::vector<std::string>\s+\w+\s*=\s*\{/.test(line);
			continue;
		}
		if (/^"[^"]*"\s*,?$/.test(line)) {
			hasStringEntry = true;
			continue;
		}
		if (line === '};') {
			return hasStringEntry;
		}
	}
	return false;
}



function readParameterList(text: string, openIndex: number): string {
	let depth = 0;
	for (let index = openIndex; index < text.length; index += 1) {
		const char = text[index];
		if (char === '(' || char === '<' || char === '[') {
			depth += 1;
		} else if (char === ')' || char === '>' || char === ']') {
			depth -= 1;
			if (depth === 0) return text.slice(openIndex + 1, index);
		}
	}
	return '';
}

function splitParameterList(parameters: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < parameters.length; index += 1) {
		const char = parameters[index];
		if (char === '<' || char === '(' || char === '[') {
			depth += 1;
		} else if (char === '>' || char === ')' || char === ']') {
			depth -= 1;
		} else if (char === ',' && depth === 0) {
			parts.push(parameters.slice(start, index));
			start = index + 1;
		}
	}
	const tail = parameters.slice(start);
	if (tail.trim().length !== 0) parts.push(tail);
	return parts;
}

function tsParameterNames(parameters: string): string[] {
	const names: string[] = [];
	for (const parameter of splitParameterList(parameters)) {
		let name = parameter.trim();
		if (name.length === 0) continue;
		const colon = name.indexOf(':');
		if (colon >= 0) name = name.slice(0, colon);
		const equals = name.indexOf('=');
		if (equals >= 0) name = name.slice(0, equals);
		name = name.replace(/\b(?:public|private|protected|readonly)\b/g, '').replace(/^\.\.\./, '').trim();
		if (name.length !== 0) names.push(name.replace(/^_+/, ''));
	}
	return names;
}

function cppParameterNames(parameters: string): string[] {
	const names: string[] = [];
	for (const parameter of splitParameterList(parameters)) {
		const defaultIndex = parameter.indexOf('=');
		const withoutDefault = defaultIndex >= 0 ? parameter.slice(0, defaultIndex) : parameter;
		const cleaned = withoutDefault.trim().replace(/[&*]/g, ' ');
		if (cleaned.length === 0 || cleaned === 'void') continue;
		const tokens = cleaned.split(/\s+/).filter((token) => token.length !== 0 && token !== 'const' && token !== 'volatile' && !token.startsWith('[['));
		if (tokens.length === 0) continue;
		const name = tokens[tokens.length - 1].split('=')[0].trim();
		if (/^[A-Za-z_]\w*$/.test(name)) names.push(name.replace(/^_+/, ''));
	}
	return names;
}

function putStrictFunction(map: Map<string, string[]>, name: string, params: string[]): void {
	const existing = map.get(name);
	if (!existing) {
		map.set(name, params);
		return;
	}
	if (existing.length !== params.length || existing.some((param, index) => param !== params[index])) {
		let overloadIndex = 1;
		while (map.has(`${name}#overload${overloadIndex}`)) overloadIndex += 1;
		map.set(`${name}#overload${overloadIndex}`, params);
	}
}

function hasStrictFunction(map: Map<string, string[]>, name: string): boolean {
	if (map.has(name)) return true;
	for (const key of map.keys()) {
		if (key.startsWith(`${name}#overload`)) return true;
	}
	return false;
}

function normalizeStrictConstantExpression(expression: string): string {
	let normalized = expression;
	let previous = '';
	while (previous !== normalized) {
		previous = normalized;
		normalized = normalized.replace(/\bstatic_cast<[^>]+>\(([^()]+)\)/g, '$1');
	}
	return normalized
		.replace(/\b(0x[0-9a-fA-F]+|\d+)[uU]\b/g, '$1')
		.replace(/\b(\d+(?:\.\d+)?|\.\d+)[fF]\b/g, '$1')
		.replace(/\b(?:0x[0-9a-fA-F](?:[_']?[0-9a-fA-F])*|\d(?:[_']?\d)*(?:\.\d(?:[_']?\d)*)?)\b/g, (value) => value.replace(/[_']/g, ''))
		.replace(/\bstd::size\(([A-Z0-9_]+)\)/g, '$1.length')
		.replace(/\bsizeof\(([A-Z0-9_]+)\)\/sizeof\(\1\[0\]\)/g, '$1.length')
		.replace(/\b(\d+)\.0\b/g, '$1')
		.replace(/\s+/g, '')
		.replace(/\bsizeof\(([A-Z0-9_]+)\)\/sizeof\(\1\[0\]\)/g, '$1.length');
}

function collectTsStrictSymbols(file: string): StrictRuntimeSymbols {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const constants = new Map<string, string>();
	const constantValues = new Map<string, string>();
	const functions = new Map<string, string[]>();
	for (const match of text.matchAll(/^export const\s+([A-Z0-9_]+)(?:\s*:[^\n=]+)?\s*=\s*([\s\S]*?);/gm)) {
		const name = match[1];
		const expression = match[2].trim();
		constants.set(name, file);
		if (!expression.startsWith('[') && !expression.startsWith('{') && !expression.startsWith('new ')) {
			constantValues.set(name, normalizeStrictConstantExpression(expression));
		}
	}
	for (const match of text.matchAll(/^export const\s+([A-Za-z_]\w*)\s*=\s*\(/gm)) {
		const openIndex = match.index! + match[0].length - 1;
		const parameters = readParameterList(text, openIndex);
		const closeIndex = openIndex + parameters.length + 1;
		if (/^\s*(?::[^=]+)?=>/.test(text.slice(closeIndex + 1, closeIndex + 160))) {
			putStrictFunction(functions, match[1], tsParameterNames(parameters));
		}
	}
	for (const match of text.matchAll(/^(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(/gm)) {
		const openIndex = match.index! + match[0].length - 1;
		const parameters = readParameterList(text, openIndex);
		const closeIndex = openIndex + parameters.length + 1;
		const after = text.slice(closeIndex + 1, closeIndex + 160);
		const hasBody = /^\s*(?::[^={;]+)?\{/.test(after);
		if (match[1].endsWith('Thunk')) continue;
		if (!hasBody || !hasStrictFunction(functions, match[1])) {
			putStrictFunction(functions, match[1], tsParameterNames(parameters));
		}
	}
	for (const match of text.matchAll(/^(?:export\s+)?class\s+([A-Za-z_]\w*)[^{]*\{/gm)) {
		const className = match[1];
		const openBraceIndex = match.index! + match[0].length - 1;
		const body = readBalancedBody(text, openBraceIndex);
		for (const constructorMatch of body.matchAll(/^\s*(?:public\s+|private\s+|protected\s+)?constructor\s*\(/gm)) {
			const openIndex = constructorMatch.index! + constructorMatch[0].length - 1;
			putStrictFunction(functions, className, tsParameterNames(readParameterList(body, openIndex)));
		}
	}
	for (const match of text.matchAll(/^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?([A-Za-z_]\w*)\s*\(/gm)) {
		const name = match[1];
		if (name === 'constructor' || name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'function' || name.endsWith('Thunk')) continue;
		const openIndex = match.index! + match[0].length - 1;
		const parameters = readParameterList(text, openIndex);
		const closeIndex = openIndex + parameters.length + 1;
		if (!/^\s*(?::[^={;]+)?\{/.test(text.slice(closeIndex + 1, closeIndex + 160))) continue;
		putStrictFunction(functions, name, tsParameterNames(parameters));
	}
	for (const match of text.matchAll(/^\s*(?:public\s+|private\s+|protected\s+)?get\s+([A-Za-z_]\w*)\s*\(\s*\)/gm)) {
		if (match[1].endsWith('Thunk')) continue;
		putStrictFunction(functions, match[1], []);
	}
	return { constants, constantValues, functions };
}

function collectCppStrictSymbols(files: readonly string[]): StrictRuntimeSymbols {
	const constants = new Map<string, string>();
	const constantValues = new Map<string, string>();
	const functions = new Map<string, string[]>();
	const classNames = new Set<string>();
	for (const file of files) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		for (const match of text.matchAll(/\b(?:class|struct)\s+([A-Za-z_]\w*)\b/gm)) {
			classNames.add(match[1]);
		}
	}
	for (const file of files) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		for (const match of text.matchAll(/^extern[ \t]+const[ \t]+[A-Za-z_][\w:<>,*& \t]*[ \t]+([A-Z0-9_]+)\s*;/gm)) {
			constants.set(match[1], file);
		}
		for (const match of text.matchAll(/^(?:inline[ \t]+)?const[ \t]+[A-Za-z_][\w:<>,*& \t]*[ \t]+([A-Z0-9_]+)\s*\[[^\]\n]*\]\s*=\s*\{/gm)) {
			constants.set(match[1], file);
		}
		for (const match of text.matchAll(/^(?:inline[ \t]+)?constexpr[ \t]+[A-Za-z_][\w:<>,*& \t]*[ \t]+([A-Z0-9_]+)(?:\s*\[[^\]\n]+\])?\s*(?:=\s*([^;\n{]+);|=\s*\{|\{)/gm)) {
			const name = match[1];
			constants.set(name, file);
			if (match[2]) {
				constantValues.set(name, normalizeStrictConstantExpression(match[2]));
			}
		}
		for (const match of text.matchAll(/^[ \t]*(?:[A-Za-z_~][\w:<>,*&]*[ \t]+)+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)\s*\(/gm)) {
			const rawName = match[1];
			const name = rawName.includes('::') ? rawName.slice(rawName.lastIndexOf('::') + 2) : rawName;
			if (rawName.includes('::') && rawName.slice(0, rawName.lastIndexOf('::')).endsWith(name)) continue;
			if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name.endsWith('Thunk')) continue;
			const openIndex = match.index! + match[0].length - 1;
			const closeIndex = openIndex + readParameterList(text, openIndex).length + 1;
			const after = text.slice(closeIndex + 1, closeIndex + 80);
			if (!/^\s*(?:const\s*)?(?:->[^{]+)?\{/.test(after)) continue;
			putStrictFunction(functions, name, cppParameterNames(readParameterList(text, openIndex)));
		}
		for (const className of classNames) {
			const escapedClassName = escapedRegExpLiteral(className);
			const constructorPattern = new RegExp(`^\\s*(?:explicit\\s+)?(?:[A-Za-z_]\\w*::)?${escapedClassName}\\s*\\(`, 'gm');
			for (const match of text.matchAll(constructorPattern)) {
				const openIndex = match.index! + match[0].length - 1;
				putStrictFunction(functions, className, cppParameterNames(readParameterList(text, openIndex)));
			}
		}
	}
	return { constants, constantValues, functions };
}

function collectTsClassPublicMethods(file: string, className: string): Set<string> {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const names = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isClassDeclaration(node) && node.name && node.name.text === className) {
			for (const member of node.members) {
				if (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) {
					continue;
				}
				const flags = ts.getCombinedModifierFlags(member);
				if ((flags & ts.ModifierFlags.Private) !== 0 || (flags & ts.ModifierFlags.Protected) !== 0) {
					continue;
				}
				if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
					names.add(member.name.text);
				}
			}
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return names;
}

function collectCppRuntimePublicMethods(files: readonly string[]): Set<string> {
	const header = files.find((file) => file.endsWith('runtime.h')) ?? files[0];
	const text = fs.readFileSync(path.join(repoRoot, header), 'utf8');
	const classIndex = text.indexOf('class Runtime');
	if (classIndex < 0) return new Set();
	const openBrace = text.indexOf('{', classIndex);
	if (openBrace < 0) return new Set();
	const body = readBalancedBody(text, openBrace);
	const names = new Set<string>();
	let inPublicSection = false;
	for (const rawLine of body.split('\n')) {
		const line = rawLine.replace(/\/\/.*$/, '').trim();
		if (line === 'public:') {
			inPublicSection = true;
			continue;
		}
		if (line === 'private:' || line === 'protected:') {
			inPublicSection = false;
			continue;
		}
		if (!inPublicSection || line.length === 0 || line.startsWith('friend ') || line.startsWith('using ')) {
			continue;
		}
		const match = /\b([A-Za-z_]\w*)\s*\(/.exec(line);
		if (!match) {
			continue;
		}
		const name = match[1];
		if (name === 'Runtime' || name === 'operator') {
			continue;
		}
		names.add(name);
	}
	return names;
}

function exclusionNameSet(file: string, exclusions: readonly StrictRuntimeMethodExclusion[] | undefined, present: ReadonlySet<string>): Set<string> {
	const names = new Set<string>();
	for (const exclusion of exclusions ?? []) {
		if (!present.has(exclusion.name)) {
			throw new Error(`${file}: method parity exclusion '${exclusion.name}' does not match a public method`);
		}
		if (exclusion.reason.trim().length === 0) {
			throw new Error(`${file}: method parity exclusion '${exclusion.name}' has no reason`);
		}
		names.add(exclusion.name);
	}
	return names;
}

function auditStrictRuntimeSymbolParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_symbol_parity ?? []) {
		const tsBase = path.basename(entry.ts, '.ts');
		const cppHasSameBase = entry.cpp.some((file) => path.basename(file, path.extname(file)) === tsBase);
		if (!cppHasSameBase) {
			errors.push(`${entry.ts}: no strict C++ basename peer in ${entry.cpp.join(', ')}`);
		}
		const tsSymbols = collectTsStrictSymbols(entry.ts);
		const cppSymbols = collectCppStrictSymbols(entry.cpp);
		for (const name of tsSymbols.constants.keys()) {
			if (!cppSymbols.constants.has(name)) errors.push(`${entry.ts}: constant ${name} missing from ${entry.cpp.join(', ')}`);
		}
		for (const name of cppSymbols.constants.keys()) {
			if (!tsSymbols.constants.has(name)) errors.push(`${entry.cpp.join(', ')}: constant ${name} missing from ${entry.ts}`);
		}
		for (const [name, tsValue] of tsSymbols.constantValues) {
			const cppValue = cppSymbols.constantValues.get(name);
			if (cppValue && tsValue !== cppValue) {
				errors.push(`${entry.ts}: constant ${name} value (${tsValue}) differs from C++ (${cppValue})`);
			}
		}
		for (const [name, params] of tsSymbols.functions) {
			const cppParams = cppSymbols.functions.get(name);
			if (!cppParams) {
				errors.push(`${entry.ts}: function ${name} missing from ${entry.cpp.join(', ')}`);
				continue;
			}
			if (params.length !== cppParams.length || params.some((param, index) => param !== cppParams[index])) {
				errors.push(`${entry.ts}: function ${name} params (${params.join(',')}) differ from C++ (${cppParams.join(',')})`);
			}
		}
		for (const name of cppSymbols.functions.keys()) {
			if (!tsSymbols.functions.has(name)) errors.push(`${entry.cpp.join(', ')}: function ${name} missing from ${entry.ts}`);
		}
	}
	return errors;
}



function auditStrictRuntimeMethodParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_method_parity ?? []) {
		const tsSymbols = collectTsStrictSymbols(entry.ts);
		const cppSymbols = collectCppStrictSymbols(entry.cpp);
		const compareMethod = (method: string): void => {
			const tsParams = tsSymbols.functions.get(method);
			const cppParams = cppSymbols.functions.get(method);
			if (!tsParams) {
				errors.push(`${entry.ts}: method ${method} missing (${entry.reason})`);
				return;
			}
			if (!cppParams) {
				errors.push(`${entry.cpp.join(', ')}: method ${method} missing (${entry.reason})`);
				return;
			}
			if (tsParams.length !== cppParams.length || tsParams.some((param, index) => param !== cppParams[index])) {
				errors.push(`${method}: TS params (${tsParams.join(',')}) differ from C++ (${cppParams.join(',')}) (${entry.reason})`);
			}
		};
		for (const method of entry.methods ?? []) {
			compareMethod(method);
		}
		if (entry.compare_public) {
			const tsPublic = collectTsClassPublicMethods(entry.ts, 'Runtime');
			const cppPublic = collectCppRuntimePublicMethods(entry.cpp);
			let tsExcluded: Set<string>;
			let cppExcluded: Set<string>;
			try {
				tsExcluded = exclusionNameSet(entry.ts, entry.ts_exclusions, tsPublic);
				cppExcluded = exclusionNameSet(entry.cpp.join(', '), entry.cpp_exclusions, cppPublic);
			} catch (error) {
				errors.push((error as Error).message);
				continue;
			}
			const tsComparable = [...tsPublic].filter((name) => !tsExcluded.has(name));
			const cppComparable = [...cppPublic].filter((name) => !cppExcluded.has(name));
			for (const method of tsComparable) {
				if (!cppComparable.includes(method)) {
					errors.push(`${entry.ts}: public method ${method} missing from ${entry.cpp.join(', ')} (${entry.reason})`);
				}
			}
			for (const method of cppComparable) {
				if (!tsComparable.includes(method)) {
					errors.push(`${entry.cpp.join(', ')}: public method ${method} missing from ${entry.ts} (${entry.reason})`);
					continue;
				}
				compareMethod(method);
			}
		}
	}
	return errors;
}

function collectTsShapeFields(file: string, symbol: string): string[] | null {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const collectObjectFields = (body: string): string[] => {
		const fields: string[] = [];
		let depth = 0;
		for (const rawLine of body.split('\n')) {
			const line = rawLine.replace(/\/\/.*$/, '').trim();
			if (depth === 0) {
				const match = /^([A-Za-z_]\w*)\??\s*:/.exec(line);
				if (match) fields.push(match[1]);
			}
			for (const char of line) {
				if (char === '{' || char === '<') depth += 1;
				else if (char === '}' || char === '>') depth -= 1;
			}
		}
		return fields;
	};
	const classMatch = new RegExp(`(?:export\\s+)?class\\s+${symbol}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(text);
	if (classMatch) {
		const fields: string[] = [];
		for (const line of classMatch[1].split('\n')) {
			if (/^\s*public\s+(?:readonly\s+)?[A-Za-z_]\w*\s*\(/.test(line)) continue;
			const match = /^\s*public\s+(?:readonly\s+)?([A-Za-z_]\w*)\b/.exec(line);
			if (match && match[1] !== 'constructor') fields.push(match[1]);
		}
		return fields;
	}
	const intersectionMatch = new RegExp(`export\\s+type\\s+${symbol}\\s*=\\s*([A-Za-z_]\\w*)\\s*&\\s*(?:Readonly<)?\\{([\\s\\S]*?)\\}\\s*>?;`).exec(text);
	if (intersectionMatch) {
		const fields = collectTsShapeFields(file, intersectionMatch[1]) ?? [];
		fields.push(...collectObjectFields(intersectionMatch[2]));
		return fields;
	}
	const typeMatch = new RegExp(`export\\s+type\\s+${symbol}\\s*=\\s*(?:Readonly<)?\\{([\\s\\S]*?)\\}\\s*>?;`).exec(text);
	if (typeMatch) {
		return collectObjectFields(typeMatch[1]);
	}
	const interfaceMatch = new RegExp(`export\\s+interface\\s+${symbol}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(text);
	if (interfaceMatch) {
		return collectObjectFields(interfaceMatch[1]);
	}
	return null;
}

function collectCppShapeFields(files: readonly string[], symbol: string): string[] | null {
	for (const file of files) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		const match = new RegExp(`(?:struct|class)\\s+${symbol}(?:\\s*:\\s*(?:public\\s+)?([A-Za-z_]\\w*))?\\s*\\{([\\s\\S]*?)\\n\\};`).exec(text);
		if (!match) continue;
		const fields = match[1] ? (collectCppShapeFields(files, match[1]) ?? []) : [];
		let bodyDepth = 0;
		for (const rawLine of match[2].split('\n')) {
			let line = rawLine.replace(/\/\/.*$/, '').trim();
			const depthBeforeLine = bodyDepth;
			for (const char of line) {
				if (char === '{') bodyDepth += 1;
				else if (char === '}') bodyDepth -= 1;
			}
			if (depthBeforeLine !== 0) continue;
			if (line.length === 0 || line === 'public:' || line === 'private:' || line === 'protected:' || line.startsWith('using ') || line.includes('(')) continue;
			line = line.replace(/;$/, '').split('=')[0].trim().replace(/[{}]+$/, '').trim().replace(/[&*]/g, ' ');
			const tokens = line.split(/\s+/).filter((token) => token.length !== 0 && token !== 'const');
			if (tokens.length === 0) continue;
			const field = tokens[tokens.length - 1].replace(/\[[^\]]+\]$/, '');
			if (/^[A-Za-z_]\w*$/.test(field)) fields.push(field);
		}
		return fields;
	}
	return null;
}

function auditStrictRuntimeShapeParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_shape_parity ?? []) {
		for (const symbol of entry.symbols) {
			const tsFields = collectTsShapeFields(entry.ts, symbol);
			if (!tsFields) {
				errors.push(`${entry.ts}: shape ${symbol} missing`);
				continue;
			}
			const cppFields = collectCppShapeFields(entry.cpp, symbol);
			if (!cppFields) {
				errors.push(`${entry.cpp.join(', ')}: shape ${symbol} missing`);
				continue;
			}
			if (tsFields.length !== cppFields.length || tsFields.some((field, index) => field !== cppFields[index])) {
				errors.push(`${symbol}: TS fields (${tsFields.join(',')}) differ from C++ (${cppFields.join(',')})`);
			}
		}
	}
	return errors;
}


const STRICT_RUNTIME_NO_CHURN_PATTERNS: readonly [string, RegExp][] = [
	['Array/TypedArray.from', /\b(?:Array|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)\.from\b/],
	['Buffer.from', /\bBuffer\.from\s*\(/],
	['structuredClone', /\bstructuredClone\s*\(/],
	['slice', /\.slice\s*\(/],
	['subarray', /\.subarray\s*\(/],
	['copyWithin', /\.copyWithin\s*\(/],
	['copying array proposal', /\.(?:toSorted|toSpliced|toReversed)\s*\(/],
	['map', /\.map\s*\(/],
	['filter', /\.filter\s*\(/],
	['reduce', /\.reduce\s*\(/],
	['concat', /\.concat\s*\(/],
	['new Array', /\bnew\s+Array\b/],
	['object spread', /\{\s*\.\.\./],
	['array spread', /\[\s*\.\.\./],
	['Object.assign', /\bObject\.assign\s*\(/],
	['typed array set', /\b(?:matrixWords|registerWords|lightRegisterWords|morphWeightWords|jointMatrixWords|vdpRegisters|fifoWordScratch|fifoStreamWords)\.set\s*\(/],
	['shallowcopy', /\bshallowcopy\b/],
	['deep clone', /\bdeep(?:copy|clone)?\b|\bclone\b/],
	['Number.isFinite', /\bNumber\.isFinite\b/],
	['Number.isNaN', /\bNumber\.isNaN\b/],
	['isNaN', /\bisNaN\b/],
	['typeof number', /typeof\s+[^\n]+[!=]==?\s*['\"]number['\"]/],
	['Math.floor/ceil', /\bMath\.(?:floor|ceil)\s*\(/],
	['std::memcpy', /\bstd::memcpy\b/],
	['std::memmove', /\bstd::memmove\b/],
	['std::copy', /\bstd::copy\b/],
	['std::copy_n', /\bstd::copy_n\b/],
	['std::ranges::copy', /\bstd::ranges::copy(?:_n)?\b/],
	['std::uninitialized_copy', /\bstd::uninitialized_copy(?:_n)?\b/],
	['cstring', /#include\s+<cstring>/],
	['memf32le', /\bmemf32le\b/],
	['write_mesh_vertex', /\bwrite_mesh_vertex\b/],
];

const STRICT_RUNTIME_NO_HEAP_PATTERNS: readonly [string, RegExp][] = [
	['Array/TypedArray.from', /\b(?:Array|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)\.from\b/],
	['Buffer.from', /\bBuffer\.from\s*\(/],
	['structuredClone', /\bstructuredClone\s*\(/],
	['JS typed array allocation', /\bnew\s+(?:Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array|Array)\b/],
	['JS collection allocation', /\bnew\s+(?:Map|Set|WeakMap|WeakSet)\b/],
	['JS object allocation', /\bObject\.(?:create|assign)\s*\(/],
	['JS closure allocation', /=>|\bfunction\s*\(/],
	['JS array push', /\.push\s*\(/],
	['JS array splice', /\.splice\s*\(/],
	['std::vector', /\bstd::vector\b/],
	['std::map', /\bstd::map\b/],
	['std::unordered', /\bstd::unordered_(?:map|set)\b/],
	['std::function', /\bstd::function\b/],
	['std::optional', /\bstd::optional\b/],
	['std::any', /\bstd::any\b/],
	['std::string', /\bstd::string\b/],
	['std::make_unique', /\bstd::make_unique\b/],
	['std::make_shared', /\bstd::make_shared\b/],
	['new expression', /\bnew\s+(?:\(|[A-Za-z_])/],
	['delete expression', /\bdelete\b/],
	['push_back', /\.push_back\s*\(/],
	['emplace_back', /\.emplace_back\s*\(/],
	['resize', /\.resize\s*\(/],
	['assign', /\.assign\s*\(/],
];

const STRICT_LUA_NO_HEAP_PATTERNS: readonly [string, RegExp][] = [
	['table literal', /[{}]/],
	['function literal', /\bfunction\b/],
	['table library', /\btable\./],
	['pairs iterator', /\bpairs\s*\(/],
	['ipairs iterator', /\bipairs\s*\(/],
	['coroutine', /\bcoroutine\./],
	['metatable', /\b(?:setmetatable|getmetatable)\s*\(/],
	['string library', /\bstring\./],
	['string concat', /\.\./],
];

const LUA_STRUCT_AGGREGATE_MEMWRITE_START = /\bmemwrite\s*\(\s*&/;

function updateLuaStructAggregateMemwriteDepth(line: string, depth: { value: number }): boolean {
	let scanStart = 0;
	if (depth.value === 0) {
		const match = LUA_STRUCT_AGGREGATE_MEMWRITE_START.exec(line);
		if (!match) return false;
		scanStart = match.index;
	}
	for (let index = scanStart; index < line.length; index += 1) {
		const char = line[index];
		if (char === '(') {
			depth.value += 1;
		} else if (char === ')') {
			depth.value -= 1;
			if (depth.value === 0) break;
		}
	}
	return true;
}

function stripLineComment(line: string): string {
	const slashCommentIndex = line.indexOf('//');
	const dashCommentIndex = line.indexOf('--');
	if (slashCommentIndex < 0) return dashCommentIndex < 0 ? line : line.slice(0, dashCommentIndex);
	if (dashCommentIndex < 0) return line.slice(0, slashCommentIndex);
	return line.slice(0, slashCommentIndex < dashCommentIndex ? slashCommentIndex : dashCommentIndex);
}

function auditStrictRuntimeNoChurn(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_no_churn ?? []) {
		for (const file of entry.files) {
			const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
			const lines = text.split('\n');
			for (let index = 0; index < lines.length; index += 1) {
				const line = stripLineComment(lines[index]);
				for (const [label, pattern] of STRICT_RUNTIME_NO_CHURN_PATTERNS) {
					if (pattern.test(line)) errors.push(`${file}:${index + 1}: forbidden churn/copy pattern ${label}`);
				}
			}
		}
	}
	return errors;
}

function auditStrictRuntimeNoChurnRegions(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_no_churn_regions ?? []) {
		const text = fs.readFileSync(path.join(repoRoot, entry.file), 'utf8');
		const startIndex = text.indexOf(entry.start);
		if (startIndex < 0) {
			errors.push(`${entry.file}: no-churn region start missing ${entry.start}`);
			continue;
		}
		const endIndex = text.indexOf(entry.end, startIndex + entry.start.length);
		if (endIndex < 0) {
			errors.push(`${entry.file}: no-churn region end missing ${entry.end}`);
			continue;
		}
		const prefixLineCount = text.slice(0, startIndex).split('\n').length - 1;
		const regionLines = text.slice(startIndex, endIndex).split('\n');
		for (let index = 0; index < regionLines.length; index += 1) {
			const line = stripLineComment(regionLines[index]);
			for (const [label, pattern] of STRICT_RUNTIME_NO_CHURN_PATTERNS) {
				if (pattern.test(line)) errors.push(`${entry.file}:${prefixLineCount + index + 1}: forbidden churn/copy pattern ${label}`);
			}
		}
	}
	return errors;
}

function auditStrictRuntimeNoHeapRegions(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_no_heap_regions ?? []) {
		const text = fs.readFileSync(path.join(repoRoot, entry.file), 'utf8');
		const startIndex = text.indexOf(entry.start);
		if (startIndex < 0) {
			errors.push(`${entry.file}: no-heap region start missing ${entry.start}`);
			continue;
		}
		const endIndex = text.indexOf(entry.end, startIndex + entry.start.length);
		if (endIndex < 0) {
			errors.push(`${entry.file}: no-heap region end missing ${entry.end}`);
			continue;
		}
		const prefixLineCount = text.slice(0, startIndex).split('\n').length - 1;
		const regionLines = text.slice(startIndex, endIndex).split('\n');
		for (let index = 0; index < regionLines.length; index += 1) {
			const line = stripLineComment(regionLines[index]);
			for (const [label, pattern] of STRICT_RUNTIME_NO_HEAP_PATTERNS) {
				if (pattern.test(line)) errors.push(`${entry.file}:${prefixLineCount + index + 1}: forbidden heap/container pattern ${label}`);
			}
		}
	}
	return errors;
}

function auditStrictLuaNoHeapRegions(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_lua_no_heap_regions ?? []) {
		const text = fs.readFileSync(path.join(repoRoot, entry.file), 'utf8');
		const startIndex = text.indexOf(entry.start);
		if (startIndex < 0) {
			errors.push(`${entry.file}: lua no-heap region start missing ${entry.start}`);
			continue;
		}
		const endIndex = text.indexOf(entry.end, startIndex + entry.start.length);
		if (endIndex < 0) {
			errors.push(`${entry.file}: lua no-heap region end missing ${entry.end}`);
			continue;
		}
		const prefixLineCount = text.slice(0, startIndex).split('\n').length - 1;
		const regionLines = text.slice(startIndex, endIndex).split('\n');
		const structAggregateMemwriteDepth = { value: 0 };
		for (let index = 0; index < regionLines.length; index += 1) {
			const line = stripLineComment(regionLines[index]);
			const inStructAggregateMemwrite = updateLuaStructAggregateMemwriteDepth(line, structAggregateMemwriteDepth);
			for (const [label, pattern] of STRICT_LUA_NO_HEAP_PATTERNS) {
				if (label === 'table literal' && inStructAggregateMemwrite) continue;
				if (pattern.test(line)) errors.push(`${entry.file}:${prefixLineCount + index + 1}: forbidden lua heap/gc pattern ${label}`);
			}
		}
	}
	return errors;
}


function readBalancedBody(text: string, openIndex: number): string {
	const openChar = text[openIndex];
	const closeChar = openChar === '[' ? ']' : openChar === '{' ? '}' : ')';
	let depth = 0;
	for (let index = openIndex; index < text.length; index += 1) {
		const char = text[index];
		if (char === openChar) {
			depth += 1;
		} else if (char === closeChar) {
			depth -= 1;
			if (depth === 0) return text.slice(openIndex + 1, index);
		}
	}
	return '';
}

function escapedRegExpLiteral(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function functionBodyRegion(text: string, name: string): { body: string; lineOffset: number } | null {
	const pattern = new RegExp(`\\b${escapedRegExpLiteral(name)}\\s*\\(`, 'g');
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		const openParenIndex = match.index + match[0].lastIndexOf('(');
		const parameters = readParameterList(text, openParenIndex);
		const closeParenIndex = openParenIndex + parameters.length + 1;
		const tail = text.slice(closeParenIndex + 1, closeParenIndex + 241);
		const braceOffset = tail.indexOf('{');
		if (braceOffset < 0) continue;
		const semicolonOffset = tail.indexOf(';');
		if (semicolonOffset >= 0 && semicolonOffset < braceOffset) continue;
		const openBraceIndex = closeParenIndex + 1 + braceOffset;
		return {
			body: readBalancedBody(text, openBraceIndex),
			lineOffset: text.slice(0, openBraceIndex + 1).split('\n').length - 1,
		};
	}
	return null;
}

function auditStrictRuntimeNoHeapFunctions(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_runtime_no_heap_functions ?? []) {
		const text = fs.readFileSync(path.join(repoRoot, entry.file), 'utf8');
		for (const name of entry.functions) {
			const region = functionBodyRegion(text, name);
			if (region === null) {
				errors.push(`${entry.file}: no-heap function missing ${name}`);
				continue;
			}
			const lines = region.body.split('\n');
			for (let index = 0; index < lines.length; index += 1) {
				const line = stripLineComment(lines[index]);
				for (const [label, pattern] of STRICT_RUNTIME_NO_HEAP_PATTERNS) {
					if (pattern.test(line)) errors.push(`${entry.file}:${region.lineOffset + index + 1}: function ${name} forbidden heap/container pattern ${label}`);
				}
			}
		}
	}
	return errors;
}

function canonicalRpuTableTokens(body: string): string {
	return body
		.replace(/\b(?:id|byteStride|attributeCount|attributes|attribute|componentCount|componentType|normalized|byteOffset|requiredFeatureMask|vertexLayout|instanceLayout|instanceMode|textureSlotCount|usesC0|lightingConstantSlot|jointConstantSlot|constantSlotCount|constantSlots|slot|maxWords|vertexVisible|fragmentVisible)\s*:/g, '')
		.match(/\b[A-Z][A-Z0-9_]*\b|\b0x[0-9a-fA-F]+[uU]?\b|\b\d+[uU]?\b/g)
		?.map((token) => token.replace(/[uU]$/, ''))
		.join(',') ?? '';
}

function tsRpuTableTokens(file: string, table: string): string | null {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const tableIndex = text.indexOf(`export const ${table}`);
	if (tableIndex < 0) return null;
	const equalsIndex = text.indexOf('=', tableIndex);
	if (equalsIndex < 0) return null;
	const openIndex = text.indexOf('[', equalsIndex);
	if (openIndex < 0) return null;
	return canonicalRpuTableTokens(readBalancedBody(text, openIndex));
}

function cppRpuTableTokens(file: string, table: string): string | null {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const tableIndex = text.indexOf(table);
	if (tableIndex < 0) return null;
	const openIndex = text.indexOf('{', tableIndex);
	if (openIndex < 0) return null;
	return canonicalRpuTableTokens(readBalancedBody(text, openIndex));
}

function auditStrictRpuTableParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_rpu_table_parity ?? []) {
		for (const table of entry.tables) {
			const tsTokens = tsRpuTableTokens(entry.ts, table);
			if (tsTokens === null) {
				errors.push(`${entry.ts}: RPU table ${table} missing`);
				continue;
			}
			const cppTokens = cppRpuTableTokens(entry.cpp, table);
			if (cppTokens === null) {
				errors.push(`${entry.cpp}: RPU table ${table} missing`);
				continue;
			}
			if (tsTokens !== cppTokens) {
				errors.push(`${table}: TS table values differ from C++`);
			}
		}
	}
	return errors;
}


function canonicalRpuShaderText(file: string): string {
	return fs.readFileSync(path.join(repoRoot, file), 'utf8')
		.replace(/layout\(std140\)\s+uniform\s+FrameUniforms\s*\{[\s\S]*?\};/g, 'uniform vec2 u_logical_size;')
		.replace(/\bu_logicalSize\b/g, 'u_logical_size')
		.replace(/\bflat\s+(in|out)\s+uint\b/g, '$1 float')
		.replace(/\buint\b/g, 'float')
		.replace(/\b(\d+)u\b/g, '$1.0')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length !== 0 && !line.startsWith('#version') && !line.startsWith('//'))
		.map((line) => line.replace(/\boutputColor\b/g, 'gl_FragColor'))
		.map((line) => line.replace(/^in\s+/, line.includes('v_') ? 'varying ' : 'attribute '))
		.map((line) => line.replace(/^out\s+/, line.includes('v_') ? 'varying ' : 'out '))
		.map((line) => line.replace(/^out\s+vec4\s+(?:outColor|gl_FragColor);$/, ''))
		.map((line) => line.replace(/\boutColor\b/g, 'gl_FragColor'))
		.map((line) => line.replace(/\btexture\s*\(/g, 'texture2D('))
		.filter((line) => line.length !== 0)
		.join('\n');
}

function auditStrictShaderParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_shader_parity ?? []) {
		if (path.basename(entry.webgl) !== path.basename(entry.gles2)) {
			errors.push(`${entry.webgl}: shader basename differs from ${entry.gles2}`);
			continue;
		}
		const webglText = canonicalRpuShaderText(entry.webgl);
		const gles2Text = canonicalRpuShaderText(entry.gles2);
		if (webglText !== gles2Text) {
			errors.push(`${entry.webgl}: shader body differs from ${entry.gles2}`);
		}
	}
	return errors;
}

type StrictIntegerToken = { kind: 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen'; text: string };

const STRICT_INTEGER_OPERATOR_PRECEDENCE = new Map<string, number>([
	['|', 1],
	['^', 2],
	['&', 3],
	['<<', 4],
	['>>', 4],
	['>>>', 4],
	['+', 5],
	['-', 5],
	['*', 6],
]);

function tokenizeStrictIntegerExpression(expression: string): StrictIntegerToken[] {
	const tokens: StrictIntegerToken[] = [];
	for (let index = 0; index < expression.length;) {
		const char = expression[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (char === '(') {
			tokens.push({ kind: 'lparen', text: char });
			index += 1;
			continue;
		}
		if (char === ')') {
			tokens.push({ kind: 'rparen', text: char });
			index += 1;
			continue;
		}
		const rest = expression.slice(index);
		const numberMatch = /^(?:0x[0-9a-fA-F]+|\d+)u?/.exec(rest);
		if (numberMatch) {
			tokens.push({ kind: 'number', text: numberMatch[0].replace(/u$/, '') });
			index += numberMatch[0].length;
			continue;
		}
		const identifierMatch = /^[A-Za-z_]\w*/.exec(rest);
		if (identifierMatch) {
			tokens.push({ kind: 'identifier', text: identifierMatch[0] });
			index += identifierMatch[0].length;
			continue;
		}
		const operatorMatch = /^(?:>>>|<<|>>|[|&^+*-])/.exec(rest);
		if (operatorMatch) {
			tokens.push({ kind: 'operator', text: operatorMatch[0] });
			index += operatorMatch[0].length;
			continue;
		}
		throw new Error(`unsupported integer token near ${rest}`);
	}
	return tokens;
}

function applyStrictIntegerOperator(operator: string, left: bigint, right: bigint): bigint {
	switch (operator) {
		case '|':
			return left | right;
		case '^':
			return left ^ right;
		case '&':
			return left & right;
		case '<<':
			return left << right;
		case '>>':
		case '>>>':
			return left >> right;
		case '+':
			return left + right;
		case '-':
			return left - right;
		case '*':
			return left * right;
		default:
			throw new Error(`unsupported integer operator ${operator}`);
	}
}

function evaluateStrictIntegerExpression(expression: string, resolveIdentifier: (name: string) => bigint): bigint {
	const tokens = tokenizeStrictIntegerExpression(expression);
	let cursor = 0;
	const parsePrimary = (): bigint => {
		const token = tokens[cursor];
		if (!token) throw new Error(`missing integer expression operand in ${expression}`);
		cursor += 1;
		if (token.kind === 'number') return BigInt(token.text);
		if (token.kind === 'identifier') return resolveIdentifier(token.text);
		if (token.kind === 'operator' && token.text === '-') return -parsePrimary();
		if (token.kind === 'lparen') {
			const value = parseExpression(1);
			const close = tokens[cursor];
			if (!close || close.kind !== 'rparen') throw new Error(`missing closing parenthesis in ${expression}`);
			cursor += 1;
			return value;
		}
		throw new Error(`unexpected token ${token.text} in ${expression}`);
	};
	const parseExpression = (minimumPrecedence: number): bigint => {
		let left = parsePrimary();
		for (;;) {
			const token = tokens[cursor];
			if (!token || token.kind !== 'operator') break;
			const precedence = STRICT_INTEGER_OPERATOR_PRECEDENCE.get(token.text);
			if (!precedence || precedence < minimumPrecedence) break;
			cursor += 1;
			const right = parseExpression(precedence + 1);
			left = applyStrictIntegerOperator(token.text, left, right);
		}
		return left;
	};
	const value = parseExpression(1);
	if (cursor !== tokens.length) throw new Error(`trailing token ${tokens[cursor].text} in ${expression}`);
	return value;
}

function collectTsIntegerConstants(files: readonly string[]): Map<string, bigint> {
	const expressions = new Map<string, string>();
	for (const file of files) {
		const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		for (const match of text.matchAll(/^export const\s+([A-Z0-9_]+)(?:\s*:[^\n=]+)?\s*=\s*([\s\S]*?);/gm)) {
			const expression = match[2].trim();
			if (expression.startsWith('[') || expression.startsWith('{') || expression.startsWith('new ')) continue;
			expressions.set(match[1], expression);
		}
	}
	return evaluateStrictIntegerConstants(expressions);
}

function collectLuaIntegerConstants(file: string): Map<string, bigint> {
	const expressions = new Map<string, string>();
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	for (const match of text.matchAll(/^local\s+([a-z0-9_]+)<const>\s*=\s*([^\n]+)/gm)) {
		const expression = match[2].trim();
		if (expression.startsWith('function') || expression.startsWith('{') || expression.includes('require(')) continue;
		expressions.set(match[1], expression);
	}
	return evaluateStrictIntegerConstants(expressions);
}

function evaluateStrictIntegerConstants(expressions: Map<string, string>): Map<string, bigint> {
	const values = new Map<string, bigint>();
	const visiting = new Set<string>();
	const resolve = (name: string): bigint => {
		const existing = values.get(name);
		if (existing !== undefined) return existing;
		const expression = expressions.get(name);
		if (expression === undefined) throw new Error(`unknown integer constant ${name}`);
		if (visiting.has(name)) throw new Error(`cyclic integer constant ${name}`);
		visiting.add(name);
		const value = evaluateStrictIntegerExpression(expression, resolve);
		visiting.delete(name);
		values.set(name, value);
		return value;
	};
	for (const name of expressions.keys()) resolve(name);
	return values;
}

function auditStrictLuaVdpAbiParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_lua_vdp_abi_parity ?? []) {
		const luaConstants = collectLuaIntegerConstants(entry.lua);
		const tsConstants = collectTsIntegerConstants(entry.ts);
		for (const symbol of entry.symbols) {
			const luaValue = luaConstants.get(symbol.lua);
			if (luaValue === undefined) {
				errors.push(`${entry.lua}: Lua VDP ABI constant ${symbol.lua} missing (${entry.reason})`);
				continue;
			}
			const tsValue = tsConstants.get(symbol.ts);
			if (tsValue === undefined) {
				errors.push(`${entry.ts.join(', ')}: TS VDP ABI constant ${symbol.ts} missing (${entry.reason})`);
				continue;
			}
			if (luaValue !== tsValue) errors.push(`${entry.lua}: ${symbol.lua}=${luaValue} differs from ${symbol.ts}=${tsValue}`);
		}
	}
	return errors;
}


function auditStrictFileLayout(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_file_layout ?? []) {
		for (const file of entry.present ?? []) {
			if (!fs.existsSync(path.join(repoRoot, file))) errors.push(`${file}: required file missing (${entry.reason})`);
		}
		for (const file of entry.absent ?? []) {
			if (fs.existsSync(path.join(repoRoot, file))) errors.push(`${file}: retired file still exists (${entry.reason})`);
		}
	}
	return errors;
}

function auditStrictFilePairParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_file_pair_parity ?? []) {
		const tsPath = path.join(repoRoot, entry.ts);
		const tsBase = path.basename(entry.ts, '.ts');
		if (!fs.existsSync(tsPath)) {
			errors.push(`${entry.ts}: strict parity TS file missing (${entry.reason})`);
			continue;
		}
		if (path.extname(entry.ts) !== '.ts') {
			errors.push(`${entry.ts}: strict parity TS file must use .ts (${entry.reason})`);
		}
		for (const cppFile of entry.cpp) {
			const cppPath = path.join(repoRoot, cppFile);
			const cppExt = path.extname(cppFile);
			const cppBase = path.basename(cppFile, cppExt);
			if (!fs.existsSync(cppPath)) {
				errors.push(`${cppFile}: strict parity C++ file missing (${entry.reason})`);
				continue;
			}
			if (cppExt !== '.h' && cppExt !== '.cpp') {
				errors.push(`${cppFile}: strict parity C++ peer must use .h or .cpp (${entry.reason})`);
			}
			if (cppBase !== tsBase) {
				errors.push(`${entry.ts}: strict parity basename ${tsBase} differs from ${cppFile} basename ${cppBase} (${entry.reason})`);
			}
		}
	}
	return errors;
}

function tsStringArrayLiteralItems(file: string, symbol: string): string[] | null {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const symbolIndex = text.indexOf(`const ${symbol}`);
	if (symbolIndex < 0) return null;
	const openIndex = text.indexOf('[', symbolIndex);
	if (openIndex < 0) return null;
	const body = readBalancedBody(text, openIndex);
	return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function cppStringVectorLiteralItems(file: string, symbol: string): string[] | null {
	const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
	const symbolIndex = text.indexOf(symbol);
	if (symbolIndex < 0) return null;
	const openIndex = text.indexOf('{', symbolIndex);
	if (openIndex < 0) return null;
	const body = readBalancedBody(text, openIndex);
	return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function auditStrictSaveStateSchemaParity(manifest: Manifest): string[] {
	const errors: string[] = [];
	for (const entry of manifest.strict_save_state_schema_parity ?? []) {
		const tsItems = tsStringArrayLiteralItems(entry.ts, entry.symbol);
		if (!tsItems) {
			errors.push(`${entry.ts}: save-state schema ${entry.symbol} missing`);
			continue;
		}
		const cppItems = cppStringVectorLiteralItems(entry.cpp, entry.symbol);
		if (!cppItems) {
			errors.push(`${entry.cpp}: save-state schema ${entry.symbol} missing`);
			continue;
		}
		if (tsItems.length !== cppItems.length) {
			errors.push(`${entry.symbol}: TS schema length ${tsItems.length} differs from C++ ${cppItems.length}`);
		}
		const count = tsItems.length < cppItems.length ? tsItems.length : cppItems.length;
		for (let index = 0; index < count; index += 1) {
			if (tsItems[index] !== cppItems[index]) errors.push(`${entry.symbol}[${index}]: TS ${tsItems[index]} differs from C++ ${cppItems[index]}`);
		}
	}
	return errors;
}

function classify(file: string, manifest: Manifest, core: Set<string>): ClassifiedFile | null {
	const pattern = matchPattern(file, manifest.patterns);
	if (pattern) return { file, category: pattern.category, reason: pattern.reason };
	if (core.has(file)) return { file, category: 'core', reason: 'reachable_from_core_root_or_must_have_cpp' };
	if (isBarrelFile(file)) return { file, category: 'barrel', reason: 'export_or_type_only_barrel' };
	return null;
}

function main(): void {
	const manifest = readJsonManifest();
	const manifestConflicts = manifestCoreScopeConflicts(manifest);
	const files: string[] = [];
	listTsFiles(path.join(repoRoot, sourceRoot), files);
	files.sort();
	const graph = buildImportGraph(files);
	const core = collectCoreReachable(manifest, graph);
	const classified: ClassifiedFile[] = [];
	const unclassified: string[] = [];
	for (const file of files) {
		const entry = classify(file, manifest, core);
		if (entry) classified.push(entry);
		else unclassified.push(file);
	}

	const missing: string[] = [];
	const fake: string[] = [];
	const cppMissingTs: string[] = [];
	const cppMissingTsExclusions = new Set((manifest.cpp_missing_ts_exclusions ?? []).map(entry => entry.cpp));
	const strictRuntimeSymbolParityErrors = auditStrictRuntimeSymbolParity(manifest);
	const strictRuntimeShapeParityErrors = auditStrictRuntimeShapeParity(manifest);
	const strictRuntimeMethodParityErrors = auditStrictRuntimeMethodParity(manifest);
	const strictRuntimeNoChurnErrors = auditStrictRuntimeNoChurn(manifest);
	const strictRuntimeNoChurnRegionErrors = auditStrictRuntimeNoChurnRegions(manifest);
	const strictRuntimeNoHeapRegionErrors = auditStrictRuntimeNoHeapRegions(manifest);
	const strictRuntimeNoHeapFunctionErrors = auditStrictRuntimeNoHeapFunctions(manifest);
	const strictLuaNoHeapRegionErrors = auditStrictLuaNoHeapRegions(manifest);
	const strictRpuTableParityErrors = auditStrictRpuTableParity(manifest);
	const strictShaderParityErrors = auditStrictShaderParity(manifest);
	const strictLuaVdpAbiParityErrors = auditStrictLuaVdpAbiParity(manifest);
	const strictFileLayoutErrors = auditStrictFileLayout(manifest);
	const strictFilePairParityErrors = auditStrictFilePairParity(manifest);
	const strictSaveStateSchemaParityErrors = auditStrictSaveStateSchemaParity(manifest);
	for (const entry of classified) {
		if (entry.category !== 'core') continue;
		const equivalents = equivalentPaths(entry.file);
		const existing = equivalents.filter((file) => fs.existsSync(path.join(repoRoot, file)));
		if (existing.length === 0) {
			missing.push(`${entry.file} -> ${equivalents.join(' or ')}`);
			continue;
		}
		if (!existing.some(cppFileHasLogic)) {
			fake.push(`${entry.file} -> ${existing.join(', ')}`);
		}
	}

	const cppFiles: string[] = [];
	listCppMachineFiles(path.join(repoRoot, cppRoot, 'machine'), cppFiles);
	cppFiles.sort();
	for (const file of cppFiles) {
		const equivalent = tsEquivalentForCppMachineFile(file);
		if (!fs.existsSync(path.join(repoRoot, equivalent)) && !cppMissingTsExclusions.has(file)) {
			cppMissingTs.push(`${file} -> ${equivalent}`);
		}
	}

	const counts = new Map<Category, number>();
	for (const entry of classified) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
	for (const category of ['core', 'host', 'ide', 'terminal', 'language', 'compiler_tooling', 'rompacker_tooling', 'cpu_interpreter_exception', 'barrel'] as Category[]) {
		console.log(`${category},${counts.get(category) ?? 0}`);
	}

	let hasErrors = false;
	if (manifestConflicts.length > 0) {
		hasErrors = true;
		console.error(`\nManifest core-scope conflicts (${manifestConflicts.length}):`);
		for (const item of manifestConflicts) console.error(`  ${item}`);
	}
	if (unclassified.length > 0) {
		hasErrors = true;
		console.error(`\nUnclassified TS files (${unclassified.length}):`);
		for (const file of unclassified) console.error(`  ${file}`);
	}
	if (missing.length > 0) {
		hasErrors = true;
		console.error(`\nCore TS files missing exact C++ equivalents (${missing.length}):`);
		for (const item of missing) console.error(`  ${item}`);
	}
	if (fake.length > 0) {
		hasErrors = true;
		console.error(`\nFake/stub C++ equivalents (${fake.length}):`);
		for (const item of fake) console.error(`  ${item}`);
	}
	if (cppMissingTs.length > 0) {
		hasErrors = true;
		console.error(`\nMachine C++ files missing exact TS equivalents (${cppMissingTs.length}):`);
		for (const item of cppMissingTs) console.error(`  ${item}`);
	}
	if (strictRuntimeSymbolParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime symbol parity errors (${strictRuntimeSymbolParityErrors.length}):`);
		for (const item of strictRuntimeSymbolParityErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeShapeParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime shape parity errors (${strictRuntimeShapeParityErrors.length}):`);
		for (const item of strictRuntimeShapeParityErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeMethodParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime method parity errors (${strictRuntimeMethodParityErrors.length}):`);
		for (const item of strictRuntimeMethodParityErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeNoChurnErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime no-churn errors (${strictRuntimeNoChurnErrors.length}):`);
		for (const item of strictRuntimeNoChurnErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeNoChurnRegionErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime no-churn region errors (${strictRuntimeNoChurnRegionErrors.length}):`);
		for (const item of strictRuntimeNoChurnRegionErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeNoHeapRegionErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime no-heap region errors (${strictRuntimeNoHeapRegionErrors.length}):`);
		for (const item of strictRuntimeNoHeapRegionErrors) console.error(`  ${item}`);
	}
	if (strictRuntimeNoHeapFunctionErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict runtime no-heap function errors (${strictRuntimeNoHeapFunctionErrors.length}):`);
		for (const item of strictRuntimeNoHeapFunctionErrors) console.error(`  ${item}`);
	}
	if (strictLuaNoHeapRegionErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict Lua no-heap region errors (${strictLuaNoHeapRegionErrors.length}):`);
		for (const item of strictLuaNoHeapRegionErrors) console.error(`  ${item}`);
	}
	if (strictRpuTableParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict RPU table parity errors (${strictRpuTableParityErrors.length}):`);
		for (const item of strictRpuTableParityErrors) console.error(`  ${item}`);
	}
	if (strictShaderParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict shader parity errors (${strictShaderParityErrors.length}):`);
		for (const item of strictShaderParityErrors) console.error(`  ${item}`);
	}
	if (strictLuaVdpAbiParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict Lua VDP ABI parity errors (${strictLuaVdpAbiParityErrors.length}):`);
		for (const item of strictLuaVdpAbiParityErrors) console.error(`  ${item}`);
	}
	if (strictFileLayoutErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict file layout errors (${strictFileLayoutErrors.length}):`);
		for (const item of strictFileLayoutErrors) console.error(`  ${item}`);
	}
	if (strictFilePairParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict file pair parity errors (${strictFilePairParityErrors.length}):`);
		for (const item of strictFilePairParityErrors) console.error(`  ${item}`);
	}
	if (strictSaveStateSchemaParityErrors.length > 0) {
		hasErrors = true;
		console.error(`\nStrict save-state schema parity errors (${strictSaveStateSchemaParityErrors.length}):`);
		for (const item of strictSaveStateSchemaParityErrors) console.error(`  ${item}`);
	}
	if (hasErrors) {
		process.exitCode = 1;
	}
}

main();
