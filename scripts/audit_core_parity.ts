import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Category = 'core' | 'host' | 'ide' | 'terminal' | 'language' | 'compiler_tooling' | 'rompacker_tooling' | 'cpu_interpreter_exception' | 'barrel';
type ManifestPattern = { pattern: string; category: Category; reason: string };
type Manifest = {
	patterns: ManifestPattern[];
	core_roots?: string[];
	must_have_cpp?: string[];
};

type ClassifiedFile = { file: string; category: Category; reason: string };

const repoRoot = process.cwd();
const sourceRoot = 'src/bmsx';
const cppRoot = 'src/bmsx_cpp';
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

	const counts = new Map<Category, number>();
	for (const entry of classified) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
	for (const category of ['core', 'host', 'ide', 'terminal', 'language', 'compiler_tooling', 'rompacker_tooling', 'cpu_interpreter_exception', 'barrel'] as Category[]) {
		console.log(`${category},${counts.get(category) ?? 0}`);
	}
	if (unclassified.length > 0) {
		console.error(`\nUnclassified TS files (${unclassified.length}):`);
		for (const file of unclassified) console.error(`  ${file}`);
	}
	if (missing.length > 0) {
		console.error(`\nCore TS files missing exact C++ equivalents (${missing.length}):`);
		for (const item of missing) console.error(`  ${item}`);
	}
	if (fake.length > 0) {
		console.error(`\nFake/stub C++ equivalents (${fake.length}):`);
		for (const item of fake) console.error(`  ${item}`);
	}
	if (manifestConflicts.length > 0 || unclassified.length > 0 || missing.length > 0 || fake.length > 0) {
		process.exitCode = 1;
	}
}

main();
