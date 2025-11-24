#!/usr/bin/env node
/*
  ts-morph based converter for class members.

  - Converts class fields to top-level vars (exported if public) using const/let with initializer awareness
  - Converts constructor to function init; parameter properties become top-level vars
  - Converts methods to function / export function, preserves async
  - Groups static members (fields + methods) into exported object: `<ClassName>Statics`
  - Rewrites `this.` to bare identifier inside non-static methods and constructors

  Usage:
	node scripts/ast-transform/convert_with_tsmorph.js <file1.ts> [file2.ts ...]
  Output:
	Writes `<file>.morph.ts` next to each input
*/

const { Project, SyntaxKind } = require('ts-morph');
const fs = require('fs');
const path = require('path');

function hasModifier(node, kind) {
	return (node.getModifiers() || []).some(m => m.getKind() === kind);
}

function isPublicLike(member) {
	if (hasModifier(member, SyntaxKind.PrivateKeyword) || hasModifier(member, SyntaxKind.ProtectedKeyword)) return false;
	return true; // default is public
}

function isReadonly(member) {
	return hasModifier(member, SyntaxKind.ReadonlyKeyword);
}

function rewriteThisInScope(scopeNode) {
	// Rewrite this.prop -> prop in the lexical class scope only.
	// Arrow functions keep lexical this; function declarations/expressions introduce new this.
	function walk(node, lexicalThis) {
		const k = node.getKind();
		if (k === SyntaxKind.PropertyAccessExpression) {
			const pae = node;
			const expr = pae.getExpression();
			if (lexicalThis && expr.getKind() === SyntaxKind.ThisKeyword) {
				pae.replaceWithText(pae.getName());
				return; // replaced; don't descend into this node's children
			}
		}
		let nextLex = lexicalThis;
		if (k === SyntaxKind.FunctionDeclaration || k === SyntaxKind.FunctionExpression || k === SyntaxKind.MethodDeclaration) {
			nextLex = false; // own this
		} else if (k === SyntaxKind.ArrowFunction) {
			// lexical this stays
		}
		node.forEachChild(child => walk(child, nextLex));
	}
	walk(scopeNode, true);
}

function renderType(node) {
	const t = node && node.getText ? node.getText() : undefined;
	return t ? `: ${t}` : '';
}

function renderParams(params) {
	return params.map(p => p.getText()).join(', ');
}

function convertFileWithTsMorph(filePath) {
	const project = global.__tsmorph_project;
	const sf = project.addSourceFileAtPathIfExists(filePath) || project.addSourceFileAtPath(filePath);

	const prelude = [];
	const generated = [];
	const trailing = [];

	// Copy over imports/exports first
	sf.getStatements().forEach(st => {
		const k = st.getKind();
		if (k === SyntaxKind.ImportDeclaration || k === SyntaxKind.ImportEqualsDeclaration || k === SyntaxKind.ExportDeclaration) {
			prelude.push(st.getText());
		}
	});

	const convertedClasses = [];
	// Process statements
	sf.getStatements().forEach(st => {
		if (st.getKind() === SyntaxKind.ClassDeclaration && st.getName()) {
			const cls = st;
			const className = cls.getName();

			const staticProps = [];
			const staticMethods = [];

			// members
			cls.getMembers().forEach(mem => {
				const mk = mem.getKind();
				if (mk === SyntaxKind.PropertyDeclaration) {
					const pd = mem;
					const name = pd.getName();
					const typeText = pd.getTypeNode() ? pd.getTypeNode().getText() : undefined;
					const initText = pd.getInitializer() ? pd.getInitializer().getText() : undefined;
					const isStatic = pd.isStatic();
					const readonly = isReadonly(pd);
					const pub = isPublicLike(pd);

					if (isStatic) {
						staticProps.push({ name, typeText, initText });
					} else {
						const useConst = readonly && !!initText;
						const kind = useConst ? 'const' : 'let';
						const exp = pub ? 'export ' : '';
						const typePart = typeText ? `: ${typeText}` : '';
						const initPart = initText ? ` = ${initText}` : '';
						generated.push(`${exp}${kind} ${name}${typePart}${initPart};`);
					}
				} else if (mk === SyntaxKind.MethodDeclaration) {
					const md = mem;
					// Drop 'override' modifier if present by not re-emitting it
					const name = md.getName();
					const isStatic = md.isStatic();
					const pub = isPublicLike(md);
					const isAsync = md.isAsync();
					const typeParams = md.getTypeParameters().length ? `<${md.getTypeParameters().map(tp => tp.getText()).join(', ')}>` : '';
					const paramsText = renderParams(md.getParameters());
					const returnType = md.getReturnTypeNode() ? `: ${md.getReturnTypeNode().getText()}` : '';
					if (md.getBody()) rewriteThisInScope(md.getBody());
					const bodyText = md.getBody() ? md.getBody().getText() : ' { }';

					if (isStatic) {
						staticMethods.push({ name, isAsync, typeParams, paramsText, returnType, bodyText });
					} else {
						const asyncPart = isAsync ? 'async ' : '';
						const exp = pub ? 'export ' : '';
						generated.push(`${exp}${asyncPart}function ${name}${typeParams}(${paramsText})${returnType}${bodyText}`);
					}
				} else if (mk === SyntaxKind.Constructor) {
					const ctor = mem;
					const params = ctor.getParameters();
					// parameter properties -> top-level
					params.forEach(p => {
						const hasAccess = hasModifier(p, SyntaxKind.PublicKeyword) || hasModifier(p, SyntaxKind.PrivateKeyword) || hasModifier(p, SyntaxKind.ProtectedKeyword);
						const isRO = hasModifier(p, SyntaxKind.ReadonlyKeyword);
						if (hasAccess || isRO) {
							const name = p.getName();
							const typeText = p.getTypeNode() ? p.getTypeNode().getText() : undefined;
							const initText = p.getInitializer() ? p.getInitializer().getText() : undefined;
							const pub = hasModifier(p, SyntaxKind.PublicKeyword) || (!hasModifier(p, SyntaxKind.PrivateKeyword) && !hasModifier(p, SyntaxKind.ProtectedKeyword));
							const useConst = isRO && !!initText;
							const kind = useConst ? 'const' : 'let';
							const exp = pub ? 'export ' : '';
							const typePart = typeText ? `: ${typeText}` : '';
							const initPart = initText ? ` = ${initText}` : '';
							generated.push(`${exp}${kind} ${name}${typePart}${initPart};`);
						}
					});

					// init function
					const paramsText = renderParams(params.map(p => {
						// remove modifiers for init signature
						const clone = p.getText()
							.replace(/\b(public|private|protected|readonly|override)\s+/g, '');
						return { getText: () => clone };
					}));
					if (ctor.getBody()) rewriteThisInScope(ctor.getBody());
					const bodyText = ctor.getBody() ? ctor.getBody().getText() : ' { }';
					generated.push(`function init(${paramsText})${bodyText}`);
				} else {
					// skip other member types but keep a comment to avoid silent loss
					generated.push(`/* Skipped class member from ${className}:\n${mem.getText()}\n*/`);
				}
			});

			// emit static group if present
			if (staticProps.length || staticMethods.length) {
				const staticLines = [];
				staticProps.forEach(sp => {
					const init = sp.initText ? sp.initText : 'undefined';
					staticLines.push(`${sp.name}: ${init}`);
				});
				staticMethods.forEach(sm => {
					const asyncPart = sm.isAsync ? 'async ' : '';
					staticLines.push(`${sm.name}: ${asyncPart}function ${sm.name}${sm.typeParams}(${sm.paramsText})${sm.returnType}${sm.bodyText}`);
				});
				const obj = `export const ${className}Statics = {\n  ${staticLines.join(',\n  ')}\n};`;
				generated.push(obj);
			}

			// record for rewire and do not carry over the class declaration itself
			convertedClasses.push({ className, sourceFile: sf });
		} else if (st.getKind() === SyntaxKind.ImportDeclaration || st.getKind() === SyntaxKind.ImportEqualsDeclaration || st.getKind() === SyntaxKind.ExportDeclaration) {
			// already handled in prelude
		} else {
			// preserve other non-class statements
			trailing.push(st.getText());
		}
	});

	const out = [
		...prelude,
		'',
		...generated,
		'',
		...trailing
	].join('\n');

	const outPath = filePath.replace(/\.ts$/, '') + '.morph.ts';
	fs.writeFileSync(outPath, out, 'utf8');
	console.log('Wrote', outPath);
	return { outPath, convertedClasses };
}

function main() {
	const argv = process.argv.slice(2);
	let tsconfigPath = null;
	let flattenInstances = false;
	const files = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--project' || a === '-p') { tsconfigPath = argv[++i]; continue; }
		if (a === '--flatten-instances') { flattenInstances = true; continue; }
		files.push(a);
	}
	if (files.length === 0) {
		console.error('Usage: node scripts/ast-transform/convert_with_tsmorph.js [--project tsconfig.json] <file1.ts> [file2.ts ...]');
		process.exit(2);
	}
	// Initialize project
	if (tsconfigPath) {
		global.__tsmorph_project = new Project({ tsConfigFilePath: tsconfigPath });
		// Ensure we load source files for rewiring across the project
		try {
			global.__tsmorph_project.addSourceFilesAtPaths('src/**/*.ts');
		} catch { }
	} else {
		global.__tsmorph_project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
	}

	const conversions = [];
	files.forEach(p => {
		const full = path.resolve(p);
		if (!fs.existsSync(full)) { console.error('File not found:', full); return; }
		conversions.push({ file: full, ...convertFileWithTsMorph(full) });
	});

	// Cross-file rewire only when a project is available
	if (tsconfigPath) {
		rewireProjectImports(global.__tsmorph_project, conversions, { flattenInstances });
		global.__tsmorph_project.saveSync();
	}
}

if (require.main === module) main();

function rewireProjectImports(project, conversions, options) {
	const flattenInstances = options && options.flattenInstances;
	// Build quick lookup from original file (no ext) to morph file path and class names
	const byFile = new Map();
	conversions.forEach(c => {
		const noext = c.file.replace(/\.[tj]sx?$/, '');
		byFile.set(path.normalize(noext), { morphPath: c.outPath, classes: c.convertedClasses.map(cc => cc.className) });
	});

	project.getSourceFiles().forEach(sf => {
		sf.getImportDeclarations().forEach(imp => {
			const spec = imp.getModuleSpecifierValue();
			let resolved = imp.getModuleSpecifierSourceFile();
			let origNoExt;
			if (resolved) {
				origNoExt = path.normalize(resolved.getFilePath().replace(/\.[tj]sx?$/, ''));
			} else if (spec.startsWith('.')) {
				const guessed = path.resolve(sf.getDirectoryPath(), spec);
				origNoExt = path.normalize(guessed);
			} else {
				return;
			}
			const info = byFile.get(origNoExt);
			if (!info) return;

			// Update module specifier to point to the .morph file relatively
			const importerDir = sf.getDirectoryPath();
			const targetMorph = info.morphPath;
			let rel = path.relative(importerDir, targetMorph).replace(/\\/g, '/');
			if (!rel.startsWith('.')) rel = './' + rel;
			// strip extension according to TS module resolution preferences
			rel = rel.replace(/\.[tj]sx?$/, '');
			imp.setModuleSpecifier(rel);

			// For each class imported from this module, rewire usage
			const named = imp.getNamedImports().map(n => n.getName());
			const defaultImport = imp.getDefaultImport() ? imp.getDefaultImport().getText() : null;

			const classCandidates = new Set([...named, defaultImport].filter(Boolean).filter(n => info.classes.includes(n)));
			if (classCandidates.size === 0) return;

			const needInit = new Set();
			const needStatics = new Set();
			const needMembers = new Set(); // functions/vars from instance members

			// Rewrite new ClassName(...) -> init(...)
			sf.forEachDescendant(d => {
				if (d.getKind() === SyntaxKind.NewExpression) {
					const ne = d;
					const expr = ne.getExpression();
					if (expr && expr.getKind() === SyntaxKind.Identifier) {
						const n = expr.getText();
						if (classCandidates.has(n)) {
							const argsText = ne.getArguments().map(a => a.getText()).join(', ');
							ne.replaceWithText(`init(${argsText})`);
							needInit.add('init');
						}
					}
				} else if (d.getKind() === SyntaxKind.PropertyAccessExpression) {
					const pae = d;
					const expr = pae.getExpression();
					if (expr.getKind() === SyntaxKind.Identifier) {
						const n = expr.getText();
						if (classCandidates.has(n)) {
							const name = pae.getName();
							pae.replaceWithText(`${n}Statics.${name}`);
							needStatics.add(`${n}Statics`);
						}
					}
				}
			});

			// Optional: flatten instance variables and usages conservatively
			if (flattenInstances) {
				// Step 1: detect const obj = init(...)
				const candidates = [];
				sf.getVariableDeclarations().forEach(decl => {
					const nameNode = decl.getNameNode();
					const init = decl.getInitializer();
					if (!init || nameNode.getKind() !== SyntaxKind.Identifier) return;
					const id = nameNode.getText();
					// must be part of a const declaration
					const vdList = decl.getParent();
					const isConst = vdList.getDeclarationKind() === 'const';
					if (!isConst) return;

					let isTarget = false;
					if (init.getKind() === SyntaxKind.CallExpression) {
						const ce = init;
						const ex = ce.getExpression();
						if (ex.getKind() === SyntaxKind.Identifier && ex.getText() === 'init') {
							isTarget = true;
						}
					} else if (init.getKind() === SyntaxKind.NewExpression) {
						const ne = init;
						const ex = ne.getExpression();
						if (ex.getKind() === SyntaxKind.Identifier && classCandidates.has(ex.getText())) {
							isTarget = true;
						}
					}
					if (!isTarget) return;

					candidates.push({ decl, id });
				});

				// Step 2: for each candidate, ensure all usages are safe to flatten
				candidates.forEach(({ decl, id }) => {
					const refs = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(x => x.getText() === id);
					let safe = true;
					const memberUses = [];
					for (const r of refs) {
						const parent = r.getParent();
						const pk = parent.getKind();
						if (pk === SyntaxKind.PropertyAccessExpression) {
							const pae = parent;
							if (pae.getExpression() === r) {
								// direct obj.member
								// ensure if it's a write (obj.member = ...), we bail out
								const grand = pae.getParent();
								if (grand && grand.getKind() === SyntaxKind.BinaryExpression && grand.getLeft() === pae) { safe = false; break; }
								memberUses.push(pae);
								continue;
							}
						}
						// Allow identifiers inside the declarator itself
						if (pk === SyntaxKind.VariableDeclaration && parent === decl) continue;
						// Any other usage (arguments, assignments, returns, spreads, etc.) => unsafe
						safe = false; break;
					}
					if (!safe) return; // skip this candidate

					// Step 3: rewrite member uses
					memberUses.forEach(pae => {
						const name = pae.getName();
						const upper = pae.getParent();
						if (upper && upper.getKind() === SyntaxKind.CallExpression && upper.getExpression() === pae) {
							// obj.method(...)
							const ce = upper;
							const args = ce.getArguments().map(a => a.getText()).join(', ');
							ce.replaceWithText(`${name}(${args})`);
						} else {
							// obj.prop -> prop
							pae.replaceWithText(name);
						}
						needMembers.add(name);
					});

					// Step 4: remove declaration but keep init side-effect
					const init = decl.getInitializer();
					const stmt = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
					if (init && stmt) {
						const initText = init.getText();
						// If declaration list has only this declarator, replace statement with `init(...);`
						const list = decl.getParent();
						if (list.getDeclarations().length === 1) {
							stmt.replaceWithText(`${initText};`);
						} else {
							// remove just the declarator
							decl.remove();
							// add expression statement after
							stmt.insertStatements(stmt.getChildIndex() + 1, `${initText};`);
						}
					}
				});
			}

			// Update import clause: add named import for init if needed
			if (needInit.size > 0) {
				const already = new Set(imp.getNamedImports().map(n => n.getName()));
				if (!already.has('init')) imp.addNamedImport('init');
			}
			// Add named import for <ClassName>Statics if needed
			needStatics.forEach(stat => {
				const already = new Set(imp.getNamedImports().map(n => n.getName()));
				if (!already.has(stat)) imp.addNamedImport(stat);
			});

			// Add named imports for flattened member uses
			needMembers.forEach(nm => {
				const already = new Set(imp.getNamedImports().map(n => n.getName()));
				if (!already.has(nm)) imp.addNamedImport(nm);
			});

			// Remove default/named import of class if not used anymore
			classCandidates.forEach(cls => {
				const identifiers = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === cls);
				const stillUsed = identifiers.some(id => {
					const parent = id.getParent();
					// If part of type annotation or import/export specifier, ignore
					const pk = parent.getKind();
					if (pk === SyntaxKind.ImportSpecifier || pk === SyntaxKind.ImportClause || pk === SyntaxKind.ExportSpecifier || pk === SyntaxKind.TypeReference) return true;
					return false;
				});
				if (!stillUsed) {
					// remove from named imports
					imp.getNamedImports().forEach(n => { if (n.getName() === cls) n.remove(); });
					// remove default if matches
					if (imp.getDefaultImport() && imp.getDefaultImport().getText() === cls) imp.removeDefaultImport();
				}
			});

			// If import becomes empty (no named, no default), keep it as bare import for side-effects? Here we remove it.
			if (imp.getNamedImports().length === 0 && !imp.getDefaultImport()) {
				imp.remove();
			}
		});

		// Update export declarations that re-export from the converted module
		sf.getExportDeclarations().forEach(exp => {
			const specVal = exp.getModuleSpecifierValue();
			let resolved = exp.getModuleSpecifierSourceFile();
			let origNoExt;
			if (resolved) {
				origNoExt = path.normalize(resolved.getFilePath().replace(/\.[tj]sx?$/, ''));
			} else if (specVal && specVal.startsWith('.')) {
				const guessed = path.resolve(sf.getDirectoryPath(), specVal);
				origNoExt = path.normalize(guessed);
			} else {
				return;
			}
			const info = byFile.get(origNoExt);
			if (!info) return;

			const exporterDir = sf.getDirectoryPath();
			const targetMorph = info.morphPath;
			let rel = path.relative(exporterDir, targetMorph).replace(/\\/g, '/');
			if (!rel.startsWith('.')) rel = './' + rel;
			rel = rel.replace(/\.[tj]sx?$/, '');
			exp.setModuleSpecifier(rel);
		});
	});
}
