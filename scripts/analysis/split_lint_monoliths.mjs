import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = process.cwd();
const sourceDir = process.argv[2];

if (!sourceDir) {
	throw new Error('Usage: node scripts/analysis/split_lint_monoliths.mjs <source-dir>');
}

const generatedFiles = new Set();
const ruleDefinitions = collectRuleDefinitions();

function splitTypeScriptCodeQuality() {
	const sourcePath = resolve(root, 'scripts/analysis/code_quality.ts');
	const sourceText = readFileSync(resolve(sourceDir, 'code_quality.ts'), 'utf8');
	const ruleModule = ruleModuleAssigner('ts');
	emitModuleGraph({
		sourcePath,
		sourceText,
		fallbackModulePath: resolve(root, 'scripts/lint/rules/ts/support/general.ts'),
		ownerForDeclaration(declaration) {
			const name = declaration.primaryName;
			if (TS_CLI_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/analysis/code_quality/cli.ts');
			}
			if (TS_SCAN_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/analysis/code_quality/source_scan.ts');
			}
			if (TS_DECLARATION_SCAN_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/analysis/code_quality/declarations.ts');
			}
			if (name === 'lintBinaryExpressionForCodeQuality') {
				return resolve(root, 'scripts/lint/rules/ts/code_quality/binary_expression_quality.ts');
			}
			if (name === 'reportSingleLineMethodIssue') {
				return ruleModule('singleLineMethodPatternRule');
			}
			const ruleRefs = declarationRuleReferences(declaration);
			if (ruleRefs.length === 1) {
				return ruleModule(ruleRefs[0]);
			}
			if (ruleRefs.length > 1) {
				return resolve(root, 'scripts/lint/rules/ts/code_quality/composite_expression_quality.ts');
			}
			if (TS_TYPE_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/lint/rules/ts/support/types.ts');
			}
			return tsSupportModuleForName(name);
		},
	});
}

function splitCppQualityRules() {
	const sourcePath = resolve(root, 'scripts/analysis/cpp_quality/rules.ts');
	const sourceText = readFileSync(resolve(sourceDir, 'cpp_rules.ts'), 'utf8');
	const ruleModule = ruleModuleAssigner('cpp');
	emitModuleGraph({
		sourcePath,
		sourceText,
		fallbackModulePath: resolve(root, 'scripts/lint/rules/cpp/support/general.ts'),
		ownerForDeclaration(declaration) {
			const name = declaration.primaryName;
			if (CPP_FUNCTION_USAGE_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/lint/rules/cpp/support/function_usage.ts');
			}
			if (name === 'lintCppLocalBindings') {
				return ruleModule('localConstPatternRule');
			}
			if (name === 'lintCppHotPathCalls') {
				return resolve(root, 'scripts/lint/rules/cpp/code_quality/hot_path_calls.ts');
			}
			if (name === 'collectCppNormalizedBody') {
				return ruleModule('normalizedAstDuplicatePatternRule');
			}
			const ruleRefs = declarationRuleReferences(declaration);
			if (ruleRefs.length === 1) {
				return ruleModule(ruleRefs[0]);
			}
			if (ruleRefs.length > 1) {
				return resolve(root, 'scripts/lint/rules/cpp/code_quality/composite_quality.ts');
			}
			if (CPP_TYPE_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/lint/rules/cpp/support/types.ts');
			}
			return cppSupportModuleForName(name);
		},
	});
	rmSync(resolve(root, 'scripts/analysis/cpp_quality/rules.ts'), { force: true });
}

function splitLuaCartLinter() {
	const sourcePath = resolve(root, 'scripts/rompacker/cart_lua_linter.ts');
	const sourceText = readFileSync(resolve(sourceDir, 'cart_lua_linter.ts'), 'utf8');
	const ruleModule = ruleModuleAssigner('lua');
	emitModuleGraph({
		sourcePath,
		sourceText,
		fallbackModulePath: resolve(root, 'scripts/lint/rules/lua_cart/impl/support/general.ts'),
		ownerForDeclaration(declaration) {
			const name = declaration.primaryName;
			if (LUA_RUNTIME_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts');
			}
			if (LUA_TYPE_DECLARATIONS.has(name)) {
				return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/types.ts');
			}
			if (name === 'lintFunctionBody' || name === 'lintStatements' || name === 'lintExpression') {
				return resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts');
			}
			const explicitOwner = LUA_EXPLICIT_RULE_OWNERS.get(name);
			if (explicitOwner) {
				return ruleModule(explicitOwner);
			}
			const ruleRefs = declarationRuleReferences(declaration);
			if (ruleRefs.length === 1) {
				return ruleModule(ruleRefs[0]);
			}
			if (ruleRefs.length > 1) {
				return resolve(root, 'scripts/lint/rules/lua_cart/impl/composite_quality.ts');
			}
			return luaSupportModuleForName(name);
		},
	});
	rmSync(resolve(root, 'scripts/rompacker/cart_lua_linter.ts'), { force: true });
}

function rewriteEntrypoints() {
	writeFile(
		resolve(root, 'scripts/analysis/code_quality.ts'),
		[
			"import { run } from './code_quality/cli';",
			'',
			'run();',
			'',
		].join('\n'),
	);
}

function emitModuleGraph(config) {
	const sourceFile = ts.createSourceFile(config.sourcePath, config.sourceText, ts.ScriptTarget.Latest, true);
	const imports = collectImports(sourceFile, config.sourcePath);
	const declarations = collectDeclarations(sourceFile, config.sourceText);
	const declarationsByName = new Map();
	for (const declaration of declarations) {
		for (const name of declaration.names) {
			declarationsByName.set(name, declaration);
		}
	}
	for (const declaration of declarations) {
		declaration.refs = collectIdentifierRefs(declaration.node, declarationsByName, imports.byLocalName);
		declaration.owner = config.ownerForDeclaration(declaration) ?? config.fallbackModulePath;
	}
	propagateOwners(declarations, declarationsByName, config.fallbackModulePath);
	const modules = new Map();
	for (const declaration of declarations) {
		const modulePath = declaration.owner;
		let module = modules.get(modulePath);
		if (!module) {
			module = [];
			modules.set(modulePath, module);
		}
		module.push(declaration);
	}
	for (const [modulePath, moduleDeclarations] of modules) {
		emitModule({
			modulePath,
			sourcePath: config.sourcePath,
			imports,
			declarations: moduleDeclarations.sort((a, b) => a.start - b.start),
			declarationsByName,
		});
	}
}

function emitModule(config) {
	const usedNames = new Set();
	for (const declaration of config.declarations) {
		for (const name of declaration.refs) {
			if (!declaration.names.has(name)) {
				usedNames.add(name);
			}
		}
	}
	const importLines = [];
	const importedByModule = new Map();
	const generatedImportByModule = new Map();
	for (const name of usedNames) {
		const imported = config.imports.byLocalName.get(name);
		if (imported) {
			const ruleDefinition = ruleDefinitions.byConstant.get(name);
			const moduleSpecifier = name === 'LuaCartLintRule'
				? relativeModuleSpecifier(config.modulePath, resolve(root, 'scripts/lint/lua_rule.ts'))
				: name === 'CodeQualityLintRule'
					? relativeModuleSpecifier(config.modulePath, resolve(root, 'scripts/lint/ts_rule.ts'))
				: ruleDefinition
				? relativeModuleSpecifier(config.modulePath, ruleDefinition.path)
				: moduleSpecifierFromOriginalImport(config.sourcePath, config.modulePath, imported.moduleSpecifier);
			let list = importedByModule.get(moduleSpecifier);
			if (!list) {
				list = [];
				importedByModule.set(moduleSpecifier, list);
			}
			list.push(imported);
			continue;
		}
		const referencedDeclaration = config.declarationsByName.get(name);
		if (!referencedDeclaration || referencedDeclaration.owner === config.modulePath) {
			continue;
		}
		const moduleSpecifier = relativeModuleSpecifier(config.modulePath, referencedDeclaration.owner);
		let list = generatedImportByModule.get(moduleSpecifier);
		if (!list) {
			list = new Set();
			generatedImportByModule.set(moduleSpecifier, list);
		}
		list.add(name);
	}
	for (const [moduleSpecifier, specs] of [...importedByModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		importLines.push(formatOriginalImport(moduleSpecifier, specs));
	}
	for (const [moduleSpecifier, names] of [...generatedImportByModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		importLines.push(`import { ${[...names].sort().join(', ')} } from '${moduleSpecifier}';`);
	}
	const body = config.declarations.map(declaration => exportedDeclarationText(declaration.text)).join('\n\n');
	writeFile(config.modulePath, `${importLines.join('\n')}${importLines.length === 0 ? '' : '\n\n'}${body}\n`);
}

function propagateOwners(declarations, declarationsByName, fallbackModulePath) {
	let changed = true;
	while (changed) {
		changed = false;
		for (const declaration of declarations) {
			for (const ref of declaration.refs) {
				const dependency = declarationsByName.get(ref);
				if (!dependency || dependency === declaration) {
					continue;
				}
				if (dependency.owner === undefined) {
					dependency.owner = declaration.owner;
					changed = true;
					continue;
				}
			}
		}
	}
}

function collectDeclarations(sourceFile, sourceText) {
	const declarations = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		if (
			ts.isFunctionDeclaration(statement)
			|| ts.isTypeAliasDeclaration(statement)
			|| ts.isInterfaceDeclaration(statement)
			|| ts.isVariableStatement(statement)
		) {
			const names = declarationNames(statement, sourceFile);
			if (names.size === 0) {
				continue;
			}
			declarations.push({
				node: statement,
				names,
				primaryName: names.values().next().value,
				start: statement.getStart(sourceFile),
				end: statement.end,
				text: sourceText.slice(statement.getStart(sourceFile), statement.end).trim(),
				owner: undefined,
				refs: new Set(),
			});
		}
	}
	return declarations;
}

function declarationNames(statement, sourceFile) {
	const names = new Set();
	if (ts.isVariableStatement(statement)) {
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name)) {
				names.add(declaration.name.text);
			} else {
				names.add(declaration.name.getText(sourceFile));
			}
		}
		return names;
	}
	if (statement.name) {
		names.add(statement.name.text);
	}
	return names;
}

function collectIdentifierRefs(node, declarationsByName, importsByLocalName) {
	const refs = new Set();
	const visit = current => {
		if (ts.isIdentifier(current)) {
			const name = current.text;
			if (isReferenceIdentifier(current) && (declarationsByName.has(name) || importsByLocalName.has(name))) {
				refs.add(name);
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return refs;
}

function isReferenceIdentifier(node) {
	const parent = node.parent;
	if (!parent) {
		return true;
	}
	if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
		return false;
	}
	if (ts.isPropertyAssignment(parent) && parent.name === node) {
		return false;
	}
	if (ts.isPropertySignature(parent) && parent.name === node) {
		return false;
	}
	if (ts.isMethodDeclaration(parent) && parent.name === node) {
		return false;
	}
	if (ts.isMethodSignature(parent) && parent.name === node) {
		return false;
	}
	return true;
}

function collectImports(sourceFile, sourcePath) {
	const byLocalName = new Map();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const moduleSpecifier = statement.moduleSpecifier.text;
		const clause = statement.importClause;
		if (!clause) {
			continue;
		}
		if (clause.name) {
			byLocalName.set(clause.name.text, {
				kind: 'default',
				localName: clause.name.text,
				moduleSpecifier,
				typeOnly: clause.isTypeOnly,
			});
		}
		const bindings = clause.namedBindings;
		if (!bindings) {
			continue;
		}
		if (ts.isNamespaceImport(bindings)) {
			byLocalName.set(bindings.name.text, {
				kind: 'namespace',
				localName: bindings.name.text,
				moduleSpecifier,
				typeOnly: clause.isTypeOnly,
			});
			continue;
		}
		for (const element of bindings.elements) {
			const localName = element.name.text;
			const importedName = element.propertyName?.text ?? localName;
			byLocalName.set(localName, {
				kind: 'named',
				localName,
				importedName,
				moduleSpecifier,
				typeOnly: clause.isTypeOnly || element.isTypeOnly,
			});
		}
	}
	return { byLocalName, sourcePath };
}

function formatOriginalImport(moduleSpecifier, specs) {
	const defaultSpecs = specs.filter(spec => spec.kind === 'default');
	const namespaceSpecs = specs.filter(spec => spec.kind === 'namespace');
	const namedSpecs = specs.filter(spec => spec.kind === 'named');
	const lines = [];
	for (const spec of defaultSpecs) {
		lines.push(`import ${spec.typeOnly ? 'type ' : ''}${spec.localName} from '${moduleSpecifier}';`);
	}
	for (const spec of namespaceSpecs) {
		lines.push(`import ${spec.typeOnly ? 'type ' : ''}* as ${spec.localName} from '${moduleSpecifier}';`);
	}
	if (namedSpecs.length > 0) {
		const parts = namedSpecs
			.sort((a, b) => a.localName.localeCompare(b.localName))
			.map(spec => {
				const name = spec.importedName === spec.localName ? spec.localName : `${spec.importedName} as ${spec.localName}`;
				return spec.typeOnly ? `type ${name}` : name;
			});
		lines.push(`import { ${parts.join(', ')} } from '${moduleSpecifier}';`);
	}
	return lines.join('\n');
}

function moduleSpecifierFromOriginalImport(sourcePath, targetPath, originalSpecifier) {
	const ruleDefinition = ruleDefinitions.byConstant.get(importNameFromRuleSpecifier(originalSpecifier));
	if (ruleDefinition) {
		return relativeModuleSpecifier(targetPath, ruleDefinition.path);
	}
	if (!originalSpecifier.startsWith('.')) {
		return originalSpecifier;
	}
	const resolved = resolve(dirname(sourcePath), originalSpecifier);
	if (existsSync(`${resolved}.ts`)) {
		return relativeModuleSpecifier(targetPath, `${resolved}.ts`);
	}
	if (existsSync(resolved) && statSync(resolved).isDirectory() && existsSync(resolve(resolved, 'index.ts'))) {
		return relativeModuleSpecifier(targetPath, resolve(resolved, 'index.ts'));
	}
	return relativeModuleSpecifier(targetPath, resolved);
}

function importNameFromRuleSpecifier() {
	return null;
}

function exportedDeclarationText(text) {
	text = text.replace(
		'isSingleLineWrapperCandidate(functionNode: ts.Node, sourceFile: ts.SourceFile)',
		'isSingleLineWrapperCandidate(functionNode: ts.Node, _sourceFile: ts.SourceFile)',
	);
	if (/^export\b/.test(text)) {
		return text;
	}
	if (/^(async\s+)?function\b/.test(text)) {
		return `export ${text}`;
	}
	if (/^(type|interface|const|let|var)\b/.test(text)) {
		return `export ${text}`;
	}
	return text;
}

function declarationRuleReferences(declaration) {
	return [...new Set([...declaration.text.matchAll(/\b([A-Za-z][A-Za-z0-9]*Rule)\.name/g)].map(match => match[1]))];
}

function ruleModuleAssigner(language) {
	return ruleConstant => {
		const definition = ruleDefinitions.byConstant.get(ruleConstant);
		if (!definition) {
			return resolve(root, `scripts/lint/rules/${language}/support/missing_${ruleConstant}.ts`);
		}
		switch (language) {
			case 'ts':
				return resolve(root, `scripts/lint/rules/ts/${definition.domain}/${definition.fileName}`);
			case 'cpp':
				return resolve(root, `scripts/lint/rules/cpp/${definition.domain}/${definition.fileName}`);
			case 'lua':
				return resolve(root, `scripts/lint/rules/lua_cart/impl/${definition.fileName}`);
			default:
				throw new Error(`Unknown language ${language}`);
		}
	};
}

function collectRuleDefinitions() {
	const byConstant = new Map();
	const byPath = new Map();
	for (const filePath of walk(resolve(root, 'scripts/lint/rules'))) {
		if (!filePath.endsWith('.ts') || filePath.includes('/ts/') || filePath.includes('/cpp/') || filePath.includes('/impl/')) {
			continue;
		}
		const text = readFileSync(filePath, 'utf8');
		const match = text.match(/export const (\w+Rule) = defineLintRule\('([^']+)', '([^']+)'\);/);
		if (!match) {
			continue;
		}
		const definition = {
			constant: match[1],
			domain: match[2],
			name: match[3],
			path: filePath,
			fileName: filePath.slice(filePath.lastIndexOf('/') + 1),
			existingText: text,
		};
		byConstant.set(definition.constant, definition);
		byPath.set(filePath, definition);
	}
	return { byConstant, byPath };
}

function inlineRuleImplementations() {
	const moves = new Map();
	for (const filePath of [...generatedFiles]) {
		const rootFile = rootRuleFileForImplementation(filePath);
		if (rootFile === null || !existsSync(rootFile)) {
			continue;
		}
		inlineRuleImplementation(filePath, rootFile);
		moves.set(filePath, rootFile);
	}
	rewriteMovedImplementationImports(moves);
	for (const filePath of moves.keys()) {
		rmSync(filePath, { force: true });
		generatedFiles.delete(filePath);
	}
}

function rootRuleFileForImplementation(filePath) {
	const tsOrCpp = filePath.match(/scripts\/lint\/rules\/(?:ts|cpp)\/([^/]+)\/([^/]+\.ts)$/);
	if (tsOrCpp) {
		const [, domain, fileName] = tsOrCpp;
		if (domain === 'support') {
			return null;
		}
		return resolve(root, `scripts/lint/rules/${domain}/${fileName}`);
	}
	const lua = filePath.match(/scripts\/lint\/rules\/lua_cart\/impl\/([^/]+\.ts)$/);
	if (lua) {
		const definition = [...ruleDefinitions.byConstant.values()].find(rule => rule.fileName === lua[1]);
		return definition?.path ?? resolve(root, `scripts/lint/rules/lua_cart/${lua[1]}`);
	}
	return null;
}

function inlineRuleImplementation(implementationFile, rootFile) {
	const implementationText = normalizeImplementationText(readFileSync(implementationFile, 'utf8'), implementationFile);
	const rootText = readFileSync(rootFile, 'utf8');
	const rootNames = topLevelNames(rootText, rootFile);
	const implementationSource = ts.createSourceFile(implementationFile, implementationText, ts.ScriptTarget.Latest, true);
	const importTexts = [];
	const bodyTexts = [];
	for (const statement of implementationSource.statements) {
		if (ts.isImportDeclaration(statement)) {
			if (!importTargetsFile(statement, implementationFile, rootFile)) {
				importTexts.push(implementationText.slice(statement.getStart(implementationSource), statement.end).trim());
			}
			continue;
		}
		const names = declarationNames(statement, implementationSource);
		if (names.size > 0 && [...names].some(name => rootNames.has(name))) {
			continue;
		}
		bodyTexts.push(implementationText.slice(statement.getStart(implementationSource), statement.end).trim());
	}
	if (bodyTexts.length === 0) {
		return;
	}
	const rootParts = splitTopImports(rootText, rootFile);
	const imports = uniqueLines([
		...rootParts.imports,
		...importTexts.map(importText => rewriteImportSpecifierForTarget(importText, implementationFile, rootFile)),
	]);
	writeFile(rootFile, `${imports.join('\n')}${imports.length === 0 ? '' : '\n\n'}${rootParts.body.trimEnd()}\n\n${bodyTexts.join('\n\n')}\n`);
}

function normalizeImplementationText(text, filePath) {
	if (filePath.includes('/scripts/lint/rules/ts/')) {
		return text
			.replace(/\bpushLintIssue\b/g, 'pushTsLintIssue')
			.replace(/\bnodeStartLine\b/g, 'tsNodeStartLine')
			.replace(/pushTsLintIssue as pushTsLintIssue/g, 'pushTsLintIssue')
			.replace(/tsNodeStartLine as tsNodeStartLine/g, 'tsNodeStartLine');
	}
	if (filePath.includes('/scripts/lint/rules/cpp/')) {
		return text.replace(/\bstringSwitchComparisonSubject\b/g, 'cppStringSwitchComparisonSubject');
	}
	return text;
}

function topLevelNames(text, filePath) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const names = new Set();
	for (const statement of sourceFile.statements) {
		for (const name of declarationNames(statement, sourceFile)) {
			names.add(name);
		}
	}
	return names;
}

function splitTopImports(text, filePath) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const imports = [];
	let bodyStart = 0;
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) {
			break;
		}
		imports.push(text.slice(statement.getStart(sourceFile), statement.end).trim());
		bodyStart = statement.end;
	}
	return {
		imports,
		body: text.slice(bodyStart).trimStart(),
	};
}

function importTargetsFile(statement, sourcePath, targetPath) {
	if (!ts.isStringLiteral(statement.moduleSpecifier)) {
		return false;
	}
	return resolveImportPath(sourcePath, statement.moduleSpecifier.text) === targetPath;
}

function rewriteImportSpecifierForTarget(importText, sourcePath, targetPath) {
	const match = /from\s+['"]([^'"]+)['"]/.exec(importText);
	if (!match) {
		return importText;
	}
	const specifier = match[1];
	if (!specifier.startsWith('.')) {
		return importText;
	}
	const resolved = resolveImportPath(sourcePath, specifier);
	return importText.replace(specifier, relativeModuleSpecifier(targetPath, resolved));
}

function rewriteMovedImplementationImports(moves) {
	const files = [
		...walk(resolve(root, 'scripts/analysis/code_quality')),
		resolve(root, 'scripts/analysis/code_quality.ts'),
		resolve(root, 'scripts/analysis/cpp_quality/rules.ts'),
		resolve(root, 'scripts/rompacker/cart_lua_linter.ts'),
		resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts'),
		...walk(resolve(root, 'scripts/lint/rules/ts')),
		...walk(resolve(root, 'scripts/lint/rules/cpp')),
		...walk(resolve(root, 'scripts/lint/rules/lua_cart/impl')),
	].filter(path => path.endsWith('.ts') && existsSync(path));
	for (const filePath of files) {
		let text = readFileSync(filePath, 'utf8');
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
		const edits = [];
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
				continue;
			}
			const resolved = resolveImportPath(filePath, statement.moduleSpecifier.text);
			const moved = moves.get(resolved);
			if (!moved) {
				continue;
			}
			edits.push({
				start: statement.moduleSpecifier.getStart(sourceFile) + 1,
				end: statement.moduleSpecifier.end - 1,
				text: relativeModuleSpecifier(filePath, moved),
			});
		}
		if (edits.length === 0) {
			continue;
		}
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
		}
		writeFile(filePath, text);
	}
}

function resolveImportPath(sourcePath, specifier) {
	if (!specifier.startsWith('.')) {
		return specifier;
	}
	const resolved = resolve(dirname(sourcePath), specifier);
	if (existsSync(`${resolved}.ts`)) {
		return `${resolved}.ts`;
	}
	if (existsSync(resolved) && statSync(resolved).isDirectory() && existsSync(resolve(resolved, 'index.ts'))) {
		return resolve(resolved, 'index.ts');
	}
	return resolved;
}

function uniqueLines(lines) {
	const seen = new Set();
	const result = [];
	for (const line of lines) {
		if (seen.has(line)) {
			continue;
		}
		seen.add(line);
		result.push(line);
	}
	return result;
}

function tsSupportModuleForName(name) {
	if (/Semantic|semantic|SEMANTIC/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/semantic.ts');
	}
	if (/NumericLiteral/.test(name)) {
		return resolve(root, 'src/bmsx/language/ts/ast/literals.ts');
	}
	if (/Numeric|numeric|CONTRACT|Contract|Sanitiz/.test(name)) {
		return resolve(root, 'src/bmsx/language/ts/ast/semantic.ts');
	}
	if (/Nullish|nullish|Undefined|undefined|Guard|guard/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/nullish.ts');
	}
	if (/FunctionUsage|UsageCount|incrementUsage|collectFunctionUsage|getFunctionNodeUsage|AllowedBySingleLineFunctionUsage/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/function_usage.ts');
	}
	if (/SingleUse|LocalConst|Snapshot|Temporal|ConsumeBeforeClear|shouldReportLocal|shouldReportSingle/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/local_bindings.ts');
	}
	if (/DeclarationIdentifier|IdentifierProperty|WriteIdentifier|ScopeBoundary|InsideLoop|ClassScope|ExpressionInScopeFingerprint/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/bindings.ts');
	}
	if (/AssignmentOperator|BooleanProducingOperator|Comparison|Equality|Ordering|PositiveEquality|NullishEquality|NullishInequality/.test(name)) {
		return resolve(root, 'src/bmsx/language/ts/ast/operators.ts');
	}
	if (/OptionalChain|Allocation|Closure|DirectMutation|PrimitivePredicate|TrivialDelegation|PrivateOrProtected|PublicContract|Boundary|WrapperName|ExportModifier/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/runtime_patterns.ts');
	}
	if (/FunctionLike|FunctionSignature|FunctionExpression|FunctionBody|FunctionUsageExpression|UsageCountForNames/.test(name)) {
		return resolve(root, 'src/bmsx/language/ts/ast/functions.ts');
	}
	if (/Statement|LoopCondition|ParentAndSibling/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/statements.ts');
	}
	if (/Split|Join|Delimiter|Roundtrip/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/split_join.ts');
	}
	if (/CallTarget|LookupCall|ExpressionRoot|QuestionDot|TargetLeaf|callTargetText/.test(name)) {
		return resolve(root, 'src/bmsx/language/ts/ast/expressions.ts');
	}
	if (/String|Switch|OrChain|Literal|truthy|Boolean|Comparison|Equality|Fallback|Container/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/conditions.ts');
	}
	if (/Normalized|Fingerprint|Duplicate|Class|Declaration|Method|Wrapper|Facade|DIRECT|BOUNDARY/.test(name)) {
		return resolve(root, 'scripts/lint/rules/ts/support/declarations.ts');
	}
	return resolve(root, 'scripts/lint/rules/ts/support/ast.ts');
}

function cppSupportModuleForName(name) {
	if (/Semantic|semantic|SEMANTIC/.test(name)) {
		return resolve(root, 'scripts/lint/rules/cpp/support/semantic.ts');
	}
	if (/Numeric|numeric|HOT_PATH|HotPath|Boundary|Bounded|TEMPORARY/.test(name)) {
		return resolve(root, 'scripts/lint/rules/cpp/support/numeric.ts');
	}
	if (/Local|Binding|Declaration|Usage|Write|Read|Const|Ignored/.test(name)) {
		return resolve(root, 'scripts/lint/rules/cpp/support/bindings.ts');
	}
	if (/Normalized|Fingerprint|Body/.test(name)) {
		return resolve(root, 'scripts/lint/rules/cpp/support/normalization.ts');
	}
	return resolve(root, 'scripts/lint/rules/cpp/support/ast.ts');
}

function luaSupportModuleForName(name) {
	if (/Prefab|Visual|SelfGfx|stateTimelinesDrive/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/fsm_visual.ts');
	}
	if (/EventReemit|Events|Emit|HandlerEntry|Lifecycle|Delegate/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/fsm_events.ts');
	}
	if (/TickCounter|ProcessInput|RunChecks|Transition|Legacy|FSM_STATE|FORBIDDEN_FSM|Lifecycle/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/fsm_transitions.ts');
	}
	if (/IdLabel|BtId|Collection|Label|StateName|Mirror|normalizeStateName/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/fsm_labels.ts');
	}
	if (/Fsm|FSM|StateController|Tick/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/fsm_core.ts');
	}
	if (/UnusedInit/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/unused_init.ts');
	}
	if (/SingleUseHasTag/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/single_use_has_tag.ts');
	}
	if (/SingleUseLocal/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/single_use_local.ts');
	}
	if (/ConstLocal/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/const_local.ts');
	}
	if (/ConstantCopy/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/constant_copy.ts');
	}
	if (/ShadowedRequire|Require/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/require_aliases.ts');
	}
	if (/DuplicateInitializer/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/duplicate_initializers.ts');
	}
	if (/FunctionUsage|UsageCount|ReferenceName|SingleLineMethodUsage/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/function_usage.ts');
	}
	if (/ForeignObject/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/foreign_object.ts');
	}
	if (/RuntimeTag/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/runtime_tag.ts');
	}
	if (/IdentifierMentions|UsesIdentifier|DirectlyAssigns|ConditionalAssignment|Unsafe/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/identifier_flow.ts');
	}
	if (/InjectedService/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/injected_service.ts');
	}
	if (/Service|Object|Resolver|Module|Export/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/object_ownership.ts');
	}
	if (/CallExpression|CallReceiver|CallMethod|CallReceiverExpression|visitCallExpressions|findCallExpression|isGlobalCall|isErrorCall|DispatchStateEvent/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/calls.ts');
	}
	if (/HasTag|Tags|Tag/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/tags.ts');
	}
	if (/SelfImage|ImgId|Img|Image|Sprite|SelfExpressionRoot|SelfProperty|SelfAssigned|SelfBoolean/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/self_properties.ts');
	}
	if (/EnsureLocalAlias|LocalAliasReturn|EnsurePattern|GetSpace|ActionTriggered/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/cart_patterns.ts');
	}
	if (/ExpressionSignature|ExpressionKeyName/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/expression_signatures.ts');
	}
	if (/Self|Img|Image|Sprite|Tag/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/expressions.ts');
	}
	if (/Binding|Scope|Identifier|Assignment|Local/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/bindings.ts');
	}
	if (/RuntimeTag|ForeignObject|Service|Object|Resolver|Module|Export/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/object_ownership.ts');
	}
	if (/Table|Field/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/table_fields.ts');
	}
	if (/String|Comparison|Bool|Truthy|Falsy|Nil|Literal|Condition|Operator/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/conditions.ts');
	}
	if (/Getter|Setter|Wrapper|Builtin|PureCopy|Function|Parameter|Forwarded|Delegation|DisplayName|LeafName/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/functions.ts');
	}
	if (/Expression|Call|Signature|Range|Self|Img|Tag|Sprite/.test(name)) {
		return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/expressions.ts');
	}
	return resolve(root, 'scripts/lint/rules/lua_cart/impl/support/general.ts');
}

function sharedModuleForConflict(declaration, fallbackModulePath) {
	if (fallbackModulePath.includes('/ts/')) {
		return tsSupportModuleForName(declaration.primaryName);
	}
	if (fallbackModulePath.includes('/cpp/')) {
		return cppSupportModuleForName(declaration.primaryName);
	}
	if (fallbackModulePath.includes('/lua_cart/')) {
		return luaSupportModuleForName(declaration.primaryName);
	}
	return fallbackModulePath;
}

function isAnalysisEntrypointModule(modulePath) {
	return modulePath.includes('/scripts/analysis/code_quality/')
		|| modulePath.endsWith('/scripts/rompacker/cart_lua_linter_runtime.ts');
}

function relativeModuleSpecifier(fromFile, toFile) {
	let specifier = relative(dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.ts$/, '');
	if (!specifier.startsWith('.')) {
		specifier = `./${specifier}`;
	}
	return specifier;
}

function writeFile(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
	generatedFiles.add(path);
}

function walk(dir) {
	if (!existsSync(dir)) {
		return [];
	}
	const files = [];
	for (const entry of readdirSync(dir)) {
		const path = resolve(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...walk(path));
		} else {
			files.push(path);
		}
	}
	return files;
}

const TS_TYPE_DECLARATIONS = new Set([
	'DuplicateKind',
	'ClassInfo',
	'DuplicateLocation',
	'DuplicateGroup',
	'LintBinding',
	'FunctionUsageInfo',
	'CliOptions',
	'ProjectLanguage',
	'NullishLiteralKind',
	'ExplicitValueCheck',
	'FolderLintSummary',
]);

const TS_CLI_DECLARATIONS = new Set([
	'FILE_EXTENSIONS',
	'LINT_SUMMARY_MAX_FOLDER_SEGMENTS',
	'CPP_FILE_EXTENSIONS',
	'printHelp',
	'parseArgs',
	'extractRootsForLanguageDetection',
	'hasCommand',
	'runCppQuality',
	'detectProjectLanguage',
	'formatLocation',
	'formatLintIssue',
	'formatVscodeLocationLink',
	'getLintSummaryFolder',
	'formatPercent',
	'printLintSummary',
	'printCsvLintSummaryRows',
	'printCsvDuplicateSummaryRows',
	'printDuplicateSummary',
	'printQualityLedger',
	'printCsvQualityLedgerRows',
	'printTextReport',
	'quoteCsv',
	'printCsvReport',
	'toRelativePath',
	'run',
]);

const TS_SCAN_DECLARATIONS = new Set([
	'nodeIsInAnalysisRegion',
	'nodeHasAnalysisRegionLabel',
	'collectImportAliases',
	'collectNormalizedBodies',
	'collectClassInfos',
	'collectLintIssues',
]);

const TS_DECLARATION_SCAN_DECLARATIONS = new Set([
	'collectClassInfos',
	'resolveParentClassInfo',
	'isInheritedMethod',
	'recordDeclaration',
	'getMethodDiscriminator',
	'getMethodContext',
	'getEnclosingFunctionName',
	'getObjectLiteralCallContext',
	'getOwningObjectName',
	'walkDeclarations',
	'buildDuplicateGroups',
]);

const CPP_TYPE_DECLARATIONS = new Set([
	'CppLocalBinding',
	'CppFunctionUsageInfo',
]);

const CPP_FUNCTION_USAGE_DECLARATIONS = new Set([
	'createCppFunctionUsageInfo',
	'collectCppFunctionUsageCounts',
	'isCppSingleLineWrapperAllowedByUsage',
	'incrementCppUsageCount',
	'cppUsageLeafName',
]);

const LUA_TYPE_DECLARATIONS = new Set([
	'LuaLintProfile',
	'LuaLintSuppressionRange',
	'UnusedInitValueBinding',
	'UnusedInitValueScope',
	'UnusedInitValueContext',
	'SingleUseHasTagBinding',
	'SingleUseHasTagContext',
	'SingleUseLocalReportKind',
	'SingleUseLocalBinding',
	'SingleUseLocalContext',
	'ConstLocalBinding',
	'ConstLocalScope',
	'ConstLocalContext',
	'ConstantCopyBinding',
	'ConstantCopyScope',
	'ConstantCopyContext',
	'ShadowedRequireAliasBinding',
	'ShadowedRequireAliasScope',
	'ShadowedRequireAliasContext',
	'DuplicateInitializerBinding',
	'DuplicateInitializerScope',
	'DuplicateInitializerContext',
	'ForeignObjectAliasBinding',
	'ForeignObjectAliasScope',
	'ForeignObjectMutationContext',
	'RuntimeTagLookupBinding',
	'RuntimeTagLookupScope',
	'RuntimeTagLookupContext',
	'LuaCartLintOptions',
	'TopLevelLocalStringConstant',
	'FunctionUsageInfo',
	'SelfPropertyAssignmentMatch',
	'AssignmentTargetInfo',
	'LuaOptionsParameterUse',
	'FsmVisualPrefabDefaults',
	'SelfBooleanPropertyAssignmentMatch',
]);

const LUA_RUNTIME_DECLARATIONS = new Set([
	'SKIPPED_DIRECTORY_NAMES',
	'LINT_SUPPRESSION_DISABLE',
	'LINT_SUPPRESSION_ENABLE',
	'suppressedLineRangesByPath',
	'BIOS_PROFILE_DISABLED_RULES',
	'activeLintRules',
	'resolveEnabledRules',
	'collectSuppressedLineRanges',
	'isLineSuppressed',
	'normalizeWorkspacePath',
	'toWorkspaceRelativePath',
	'collectLuaFilesFromRoot',
	'collectLuaFiles',
	'pushIssue',
	'pushIssueAt',
	'formatIssues',
	'pushSyntaxErrorIssue',
	'lintCartLuaSources',
]);

const LUA_EXPLICIT_RULE_OWNERS = new Map([
	['lintSplitNestedIfHasTagPattern', 'multiHasTagPatternRule'],
	['lintForbiddenStateCalls', 'forbiddenTransitionToPatternRule'],
	['lintCrossObjectStateEventRelayPattern', 'crossObjectStateEventRelayPatternRule'],
	['lintEventHandlerDispatchPattern', 'eventHandlerDispatchPatternRule'],
	['lintDispatchFanoutLoopPattern', 'dispatchFanoutLoopPatternRule'],
	['lintDefineFactoryTickEnabledAndSpaceIdPattern', 'defineFactoryTickEnabledPatternRule'],
	['lintCollectionLabelPatterns', 'fsmIdLabelPatternRule'],
]);

cleanGeneratedTargets();
splitTypeScriptCodeQuality();
splitCppQualityRules();
splitLuaCartLinter();
inlineRuleImplementations();
rewriteEntrypoints();
stripRuntimeOnlyRuleBarrelTypes();
extractLuaLintRuntimeContext();
extractCppDiagnosticsSupport();
cleanGeneratedRuleImports();

console.log(`split ${generatedFiles.size} lint module(s)`);

function cleanGeneratedTargets() {
	for (const path of [
		resolve(root, 'scripts/analysis/code_quality'),
		resolve(root, 'scripts/lint/rules/ts'),
		resolve(root, 'scripts/lint/rules/cpp'),
		resolve(root, 'scripts/lint/rules/lua_cart/impl'),
		resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts'),
		resolve(root, 'scripts/lint/rules/code_quality/typescript_code_quality_pipeline.ts'),
	]) {
		rmSync(path, { force: true, recursive: true });
	}
}

function stripRuntimeOnlyRuleBarrelTypes() {
	const path = resolve(root, 'scripts/analysis/code_quality/cli.ts');
	let text = readFileSync(path, 'utf8');
	text = text.replace("import { type CodeQualityLintRule } from '../../lint/rules';\n", '');
	text = text.replace(/\bCodeQualityLintRule\b/g, "LintIssue['kind']");
	text = text.replace("import { type LintIssue['kind'], type TsLintIssue as LintIssue } from '../../lint/ts_rule';", "import { type TsLintIssue as LintIssue } from '../../lint/ts_rule';");
	text = text.replace("import { type LintIssue['kind'] } from '../../lint/ts_rule';\n", '');
	writeFile(path, text);

	const luaRuntimePath = resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts');
	let luaRuntime = readFileSync(luaRuntimePath, 'utf8');
	luaRuntime = luaRuntime.replace(
		"import { LUA_CART_LINT_RULES, type LuaCartLintRule } from '../lint/rules';\n",
		"import { COMMON_LANGUAGE_LINT_RULES } from '../lint/rules/common';\nimport { LUA_CART_ONLY_LINT_RULES } from '../lint/rules/lua_cart';\n",
	);
	luaRuntime = luaRuntime.replace(
		"import { LUA_CART_LINT_RULES } from '../lint/rules';\n",
		"import { COMMON_LANGUAGE_LINT_RULES } from '../lint/rules/common';\nimport { LUA_CART_ONLY_LINT_RULES } from '../lint/rules/lua_cart';\n",
	);
	luaRuntime = luaRuntime
		.replace("import { COMMON_LANGUAGE_LINT_RULES } from '../lint/rules/common';\n", '')
		.replace("import { LUA_CART_ONLY_LINT_RULES } from '../lint/rules/lua_cart';\n", '');
	const luaRuleDefinitions = [...ruleDefinitions.byConstant.values()]
		.filter(rule => rule.domain === 'common' || rule.domain === 'lua_cart' || rule.domain === 'shared')
		.sort((left, right) => left.constant.localeCompare(right.constant));
	const missingImports = [];
	for (const rule of luaRuleDefinitions) {
		if (new RegExp(`\\b${rule.constant}\\b`).test(luaRuntime)) {
			continue;
		}
		missingImports.push(`import { ${rule.constant} } from '${relativeModuleSpecifier(luaRuntimePath, rule.path)}';`);
	}
	if (missingImports.length > 0) {
		luaRuntime = `${missingImports.join('\n')}\n${luaRuntime}`;
	}
	const ruleList = `const LUA_CART_LINT_RULES: readonly LuaCartLintRule[] = [\n${luaRuleDefinitions.map(rule => `\t'${rule.name}',`).join('\n')}\n];`;
	const ruleListPattern = /const LUA_CART_LINT_RULES(?::[^\n=]+)? = \[[\s\S]*?\](?: as const)?;/;
	if (ruleListPattern.test(luaRuntime)) {
		luaRuntime = luaRuntime.replace(ruleListPattern, ruleList);
	} else {
		luaRuntime = luaRuntime.replace(/(import[\s\S]*?;\n)(?!import)/, `$1\n${ruleList}\n`);
	}
	writeFile(luaRuntimePath, luaRuntime);
}

function extractLuaLintRuntimeContext() {
	const contextPath = resolve(root, 'scripts/lint/rules/lua_cart/impl/support/lint_context.ts');
	writeFile(
		contextPath,
		[
			"import { type LuaCartLintRule, type LuaLintIssue, type LuaLintNode, pushLuaLintIssue } from '../../../../lua_rule';",
			"import { type LuaLintSuppressionRange } from './types';",
			'',
			'export const suppressedLineRangesByPath = new Map<string, ReadonlyArray<LuaLintSuppressionRange>>();',
			'',
			'export let activeLintRules: ReadonlySet<LuaCartLintRule>;',
			'',
			'export function setActiveLintRules(rules: ReadonlySet<LuaCartLintRule>): void {',
			'\tactiveLintRules = rules;',
			'}',
			'',
			'export function clearSuppressedLineRanges(): void {',
			'\tsuppressedLineRangesByPath.clear();',
			'}',
			'',
			'export function setSuppressedLineRanges(path: string, ranges: ReadonlyArray<LuaLintSuppressionRange>): void {',
			'\tsuppressedLineRangesByPath.set(path, ranges);',
			'}',
			'',
			'export function isLineSuppressed(path: string, line: number): boolean {',
			'\tconst ranges = suppressedLineRangesByPath.get(path);',
			'\tif (!ranges) {',
			'\t\treturn false;',
			'\t}',
			'\tfor (const range of ranges) {',
			'\t\tif (line < range.startLine) {',
			'\t\t\treturn false;',
			'\t\t}',
			'\t\tif (line <= range.endLine) {',
			'\t\t\treturn true;',
			'\t\t}',
			'\t}',
			'\treturn false;',
			'}',
			'',
			'export function pushIssue(issues: LuaLintIssue[], rule: LuaCartLintRule, node: LuaLintNode, message: string): void {',
			'\tpushLuaLintIssue(issues, activeLintRules, isLineSuppressed, rule, node, message);',
			'}',
			'',
			'export function pushIssueAt(issues: LuaLintIssue[], rule: LuaCartLintRule, path: string, line: number, column: number, message: string): void {',
			'\tif (!activeLintRules.has(rule)) {',
			'\t\treturn;',
			'\t}',
			'\tif (isLineSuppressed(path, line)) {',
			'\t\treturn;',
			'\t}',
			'\tissues.push({',
			'\t\trule,',
			'\t\tpath,',
			'\t\tline,',
			'\t\tcolumn,',
			'\t\tmessage,',
			'\t});',
			'}',
			'',
		].join('\n'),
	);

	rewriteLuaRuleRuntimeImports(contextPath);
	rewriteLuaRuntimeForContext(contextPath);
}

function extractCppDiagnosticsSupport() {
	const diagnosticsPath = resolve(root, 'scripts/lint/rules/cpp/support/diagnostics.ts');
	writeFile(
		diagnosticsPath,
		[
			"import type { CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';",
			'',
			'type CodeQualityLintRule = string;',
			'',
			'export type CppLintIssue = {',
			'\tkind: CodeQualityLintRule;',
			'\tfile: string;',
			'\tline: number;',
			'\tcolumn: number;',
			'\tname: string;',
			'\tmessage: string;',
			'};',
			'',
			'export type CppNormalizedBodyInfo = {',
			'\tname: string;',
			'\tfile: string;',
			'\tline: number;',
			'\tcolumn: number;',
			'\tfingerprint: string;',
			'\tsemanticSignatures: string[] | null;',
			'};',
			'',
			'export function pushLintIssue(',
			'\tissues: CppLintIssue[],',
			'\tfile: string,',
			'\ttoken: CppToken,',
			'\tkind: CodeQualityLintRule,',
			'\tmessage: string,',
			'\tname = kind,',
			'): void {',
			'\tissues.push({',
			'\t\tkind,',
			'\t\tfile,',
			'\t\tline: token.line,',
			'\t\tcolumn: token.column,',
			'\t\tname,',
			'\t\tmessage,',
			'\t});',
			'}',
			'',
		].join('\n'),
	);
	rewriteImportsToModule(
		resolve(root, 'scripts/analysis/cpp_quality/diagnostics.ts'),
		diagnosticsPath,
		walk(resolve(root, 'scripts/lint/rules')).filter(path => path.endsWith('.ts')),
	);
}

function rewriteLuaRuleRuntimeImports(contextPath) {
	const runtimePath = resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts');
	const movedNames = new Set(['activeLintRules', 'isLineSuppressed', 'pushIssue', 'pushIssueAt']);
	for (const filePath of walk(resolve(root, 'scripts/lint/rules')).filter(path => path.endsWith('.ts'))) {
		let text = readFileSync(filePath, 'utf8');
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
		const edits = [];
		const movedImports = new Map();
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
				continue;
			}
			if (resolveImportPath(filePath, statement.moduleSpecifier.text) !== runtimePath) {
				continue;
			}
			const bindings = statement.importClause?.namedBindings;
			if (!bindings || !ts.isNamedImports(bindings)) {
				continue;
			}
			const kept = [];
			for (const element of bindings.elements) {
				const importedName = element.propertyName?.text ?? element.name.text;
				const localName = element.name.text;
				const importText = importedName === localName ? localName : `${importedName} as ${localName}`;
				if (movedNames.has(importedName)) {
					movedImports.set(localName, importText);
				} else {
					kept.push(importText);
				}
			}
			const replacement = kept.length === 0
				? ''
				: `import { ${kept.join(', ')} } from '${statement.moduleSpecifier.text}';`;
			edits.push({
				start: statement.getStart(sourceFile),
				end: statement.end,
				text: replacement,
			});
		}
		if (movedImports.size === 0) {
			continue;
		}
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
		}
		const contextImport = `import { ${[...movedImports.values()].sort().join(', ')} } from '${relativeModuleSpecifier(filePath, contextPath)}';`;
		const parts = splitTopImports(text, filePath);
		const imports = uniqueLines([...parts.imports.filter(line => line.length > 0), contextImport]);
		writeFile(filePath, `${imports.join('\n')}${imports.length === 0 ? '' : '\n\n'}${parts.body.trimStart()}`);
	}
}

function rewriteLuaRuntimeForContext(contextPath) {
	const luaRuntimePath = resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts');
	let text = readFileSync(luaRuntimePath, 'utf8');
	text = text.replace(
		"import { type LuaCartLintRule, type LuaLintIssue, type LuaLintNode, pushLuaLintIssue } from '../lint/lua_rule';",
		"import { type LuaCartLintRule, type LuaLintIssue } from '../lint/lua_rule';",
	);
	text = addImportLine(
		text,
		`import { clearSuppressedLineRanges, pushIssue, pushIssueAt, setActiveLintRules, setSuppressedLineRanges } from '${relativeModuleSpecifier(luaRuntimePath, contextPath)}';`,
		luaRuntimePath,
	);
	text = removeTopLevelDeclarations(
		text,
		luaRuntimePath,
		new Set([
			'suppressedLineRangesByPath',
			'activeLintRules',
			'isLineSuppressed',
			'pushIssue',
			'pushIssueAt',
		]),
	);
	text = text
		.replace(/\bactiveLintRules = resolveEnabledRules\(profile\);/g, 'setActiveLintRules(resolveEnabledRules(profile));')
		.replace(/\bactiveLintRules = new Set\(LUA_CART_LINT_RULES\);/g, 'setActiveLintRules(new Set(LUA_CART_LINT_RULES));')
		.replace(/\bsuppressedLineRangesByPath\.clear\(\);/g, 'clearSuppressedLineRanges();')
		.replace(/\bsuppressedLineRangesByPath\.set\(workspacePath, collectSuppressedLineRanges\(source\)\);/g, 'setSuppressedLineRanges(workspacePath, collectSuppressedLineRanges(source));');
	text = text.replace(
		/(const LUA_CART_LINT_RULES(?::[^\n=]+)? = \[[\s\S]*?\];)(?!\s*setActiveLintRules)/,
		'$1\n\nsetActiveLintRules(new Set(LUA_CART_LINT_RULES));',
	);
	text = replaceRuleNameReferences(text);
	text = removeUnusedNamedImports(text, luaRuntimePath);
	writeFile(luaRuntimePath, text);
}

function replaceRuleNameReferences(text) {
	for (const rule of ruleDefinitions.byConstant.values()) {
		text = text.replace(new RegExp(`\\b${rule.constant}\\.name\\b`, 'g'), `'${rule.name}'`);
	}
	return text;
}

function rewriteImportsToModule(fromModulePath, toModulePath, files) {
	for (const filePath of files) {
		let text = readFileSync(filePath, 'utf8');
		const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
		const edits = [];
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
				continue;
			}
			if (resolveImportPath(filePath, statement.moduleSpecifier.text) !== fromModulePath) {
				continue;
			}
			edits.push({
				start: statement.moduleSpecifier.getStart(sourceFile) + 1,
				end: statement.moduleSpecifier.end - 1,
				text: relativeModuleSpecifier(filePath, toModulePath),
			});
		}
		if (edits.length === 0) {
			continue;
		}
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
		}
		writeFile(filePath, text);
	}
}

function cleanGeneratedRuleImports() {
	const files = [
		...walk(resolve(root, 'scripts/lint/rules')).filter(path => path.endsWith('.ts')),
		resolve(root, 'scripts/rompacker/cart_lua_linter_runtime.ts'),
	].filter(path => existsSync(path));
	for (const filePath of files) {
		let text = readFileSync(filePath, 'utf8');
		text = disambiguateGeneratedHelperNames(text, filePath);
		text = removeImportsOfLocalDeclarations(text, filePath);
		text = mergeNamedImports(text, filePath);
		text = removeUnusedNamedImports(text, filePath);
		text = compactBlankLines(text);
		writeFile(filePath, text);
	}
}

function disambiguateGeneratedHelperNames(text, filePath) {
	if (!filePath.endsWith('/scripts/lint/rules/common/string_switch_chain_pattern.ts')) {
		return text;
	}
	return text
		.replace(
			'function stringSwitchComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null',
			'function cppStringSwitchComparisonSubject(tokens: readonly CppToken[], start: number, end: number): string | null',
		)
		.replace(/\bstringSwitchComparisonSubject\(tokens,/g, 'cppStringSwitchComparisonSubject(tokens,');
}

function removeImportsOfLocalDeclarations(text, filePath) {
	const locals = topLevelNames(text, filePath);
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const edits = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const clause = statement.importClause;
		const bindings = clause?.namedBindings;
		if (!clause || !bindings || !ts.isNamedImports(bindings)) {
			continue;
		}
		const kept = [];
		for (const element of bindings.elements) {
			if (!locals.has(element.name.text)) {
				kept.push(importElementText(text, sourceFile, clause, element));
			}
		}
		if (kept.length === bindings.elements.length) {
			continue;
		}
		if (kept.length === 0 && !clause.name) {
			edits.push({ start: statement.getStart(sourceFile), end: statement.end, text: '' });
			continue;
		}
		const defaultPart = clause.name ? `${clause.name.text}, ` : '';
		edits.push({
			start: statement.getStart(sourceFile),
			end: statement.end,
			text: `import ${clause.isTypeOnly ? 'type ' : ''}${defaultPart}{ ${kept.join(', ')} } from '${statement.moduleSpecifier.text}';`,
		});
	}
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
	}
	return text;
}

function mergeNamedImports(text, filePath) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const groups = new Map();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const clause = statement.importClause;
		const bindings = clause?.namedBindings;
		if (!clause || clause.name || !bindings || !ts.isNamedImports(bindings)) {
			continue;
		}
		const specifier = statement.moduleSpecifier.text;
		let group = groups.get(specifier);
		if (!group) {
			group = [];
			groups.set(specifier, group);
		}
		group.push({ statement, clause, bindings });
	}
	const edits = [];
	for (const [specifier, group] of groups) {
		if (group.length <= 1) {
			continue;
		}
		const imports = new Map();
		for (const entry of group) {
			for (const element of entry.bindings.elements) {
				if (!imports.has(element.name.text)) {
					imports.set(element.name.text, importElementText(text, sourceFile, entry.clause, element));
				}
			}
		}
		const first = group[0].statement;
		edits.push({
			start: first.getStart(sourceFile),
			end: first.end,
			text: `import { ${[...imports.values()].sort().join(', ')} } from '${specifier}';`,
		});
		for (let index = 1; index < group.length; index += 1) {
			const statement = group[index].statement;
			edits.push({ start: statement.getStart(sourceFile), end: statement.end, text: '' });
		}
	}
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
	}
	return text;
}

function importElementText(text, sourceFile, clause, element) {
	const elementText = text.slice(element.getStart(sourceFile), element.end);
	return clause.isTypeOnly && !/^type\b/.test(elementText) ? `type ${elementText}` : elementText;
}

function compactBlankLines(text) {
	return `${text.replace(/(import [^\n]+;\n)\n+(?=import )/g, '$1').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function addImportLine(text, importLine, filePath) {
	if (text.includes(importLine)) {
		return text;
	}
	const parts = splitTopImports(text, filePath);
	const imports = uniqueLines([...parts.imports, importLine]);
	return `${imports.join('\n')}\n\n${parts.body.trimStart()}`;
}

function removeTopLevelDeclarations(text, filePath, namesToRemove) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const edits = [];
	for (const statement of sourceFile.statements) {
		const names = declarationNames(statement, sourceFile);
		if (names.size === 0) {
			continue;
		}
		if ([...names].some(name => namesToRemove.has(name))) {
			edits.push({
				start: statement.getStart(sourceFile),
				end: statement.end,
			});
		}
	}
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		text = text.slice(0, edit.start) + text.slice(edit.end);
	}
	return text;
}

function removeUnusedNamedImports(text, filePath) {
	const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
	const importRanges = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			importRanges.push([statement.getStart(sourceFile), statement.end]);
		}
	}
	let bodyText = text;
	for (const [start, end] of importRanges.sort((a, b) => b[0] - a[0])) {
		bodyText = `${bodyText.slice(0, start)}${' '.repeat(end - start)}${bodyText.slice(end)}`;
	}
	const edits = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}
		const clause = statement.importClause;
		const bindings = clause?.namedBindings;
		if (!clause || !bindings || !ts.isNamedImports(bindings)) {
			continue;
		}
		const kept = [];
		for (const element of bindings.elements) {
			if (new RegExp(`\\b${element.name.text}\\b`).test(bodyText)) {
				kept.push(text.slice(element.getStart(sourceFile), element.end));
			}
		}
		if (kept.length === bindings.elements.length) {
			continue;
		}
		if (kept.length === 0 && !clause.name) {
			edits.push({
				start: statement.getStart(sourceFile),
				end: statement.end,
				text: '',
			});
			continue;
		}
		if (kept.length === 0) {
			edits.push({
				start: statement.getStart(sourceFile),
				end: statement.end,
				text: `import ${clause.isTypeOnly ? 'type ' : ''}${clause.name.text} from '${statement.moduleSpecifier.text}';`,
			});
			continue;
		}
		const defaultPart = clause.name ? `${clause.name.text}, ` : '';
		edits.push({
			start: statement.getStart(sourceFile),
			end: statement.end,
			text: `import ${clause.isTypeOnly ? 'type ' : ''}${defaultPart}{ ${kept.join(', ')} } from '${statement.moduleSpecifier.text}';`,
		});
	}
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
	}
	return text;
}
