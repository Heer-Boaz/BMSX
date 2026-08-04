import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

import { splitText } from '../../machine/ts/common/text_lines';
import { collectLuaModuleDependencies } from '../../toolchain/ts/lua/compiler/module_graph';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';

type CartlibDisposition = 'keep' | 'move' | 'delete';

type CartlibSurfaceModule = {
	current_path: string;
	final_owner: string;
	disposition: CartlibDisposition;
	target_path?: string;
	consumers: {
		carts: string[];
		tooling: string[];
	};
	representation: string;
	hot_functions: Array<{
		name: string;
		evidence: 'covered' | 'missing';
		tests: string[];
	}>;
	contract_tests: string[];
};

type CartlibSurfaceInventory = {
	version: number;
	state: 'pre_core_baseline';
	cart_projects: string[];
	modules: CartlibSurfaceModule[];
};

const INVENTORY_PATH = 'scripts/cartlib_surface_inventory.json';
const TEST_PATH = 'tests/lua/cartlib_surface_inventory.test.ts';
const TOOLING_ROOTS = ['hosts', 'ide', 'machine', 'scripts', 'tests', 'toolchain'];
const CARTLIB_PATH_VALUE_PATTERN = /^cartlib\/[A-Za-z0-9_\/-]+(?:\.lua)?$/;
const TOOLING_SOURCE_PATTERN = /\.(?:json|js|mjs|mts|ts|lua)$/;
const DISPOSITIONS = new Set<CartlibDisposition>(['keep', 'move', 'delete']);

function collectFiles(directory: string, accept: (file: string) => boolean): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'dist' || entry.name === 'node_modules') {
			continue;
		}
		const file = path.join(directory, entry.name).replaceAll('\\', '/');
		if (entry.isDirectory()) {
			files.push(...collectFiles(file, accept));
		} else if (accept(file)) {
			files.push(file);
		}
	}
	return files;
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values)].sort();
}

const liveModules = collectFiles('cartlib', file => file.endsWith('.lua')).sort();
const moduleById = new Map(liveModules.map(file => [file.slice(0, -4), file]));
const moduleIds = new Set(moduleById.keys());

function cartlibDependencies(file: string, source: string): string[] {
	const lexer = new LuaLexer(source, file);
	const parser = new LuaParser(lexer.scanTokens(), file, splitText(source));
	return collectLuaModuleDependencies(parser.parseChunk(), moduleIds);
}

function literalToolingCartlibPaths(file: string, source: string): string[] {
	if (file.endsWith('.lua')) {
		return cartlibDependencies(file, source);
	}
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		false,
		file.endsWith('.json') ? ts.ScriptKind.JSON : ts.ScriptKind.TS,
	);
	const paths: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isStringLiteralLike(node) && CARTLIB_PATH_VALUE_PATTERN.test(node.text)) {
			paths.push(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return paths;
}

const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as CartlibSurfaceInventory;

function collectCartConsumers(): {
	projects: string[];
	byModule: Map<string, string[]>;
} {
	const importsByModule = new Map<string, string[]>();
	for (const file of liveModules) {
		const imports = cartlibDependencies(file, readFileSync(file, 'utf8'))
			.map(moduleId => moduleById.get(moduleId))
			.filter(target => target !== undefined);
		importsByModule.set(file, sortedUnique(imports));
	}

	const byModule = new Map(liveModules.map(file => [file, new Set<string>()]));
	const projects = new Set<string>();
	for (const file of collectFiles('carts', candidate => candidate.endsWith('.lua'))) {
		const roots = cartlibDependencies(file, readFileSync(file, 'utf8'))
			.map(moduleId => moduleById.get(moduleId))
			.filter(target => target !== undefined);
		if (roots.length === 0) {
			continue;
		}
		const project = file.split('/')[1];
		projects.add(project);
		const reached = new Set(roots);
		const pending = [...roots];
		while (pending.length > 0) {
			const current = pending.pop()!;
			byModule.get(current)!.add(project);
			for (const target of importsByModule.get(current)!) {
				if (!reached.has(target)) {
					reached.add(target);
					pending.push(target);
				}
			}
		}
	}

	return {
		projects: [...projects].sort(),
		byModule: new Map([...byModule].map(([file, consumers]) => [file, [...consumers].sort()])),
	};
}

function collectToolingConsumers(): Map<string, string[]> {
	const excluded = new Set([INVENTORY_PATH, TEST_PATH]);
	const byModule = new Map(liveModules.map(file => [file, new Set<string>()]));
	const files = TOOLING_ROOTS.flatMap(root => collectFiles(root, file => TOOLING_SOURCE_PATTERN.test(file)));
	for (const file of files) {
		if (excluded.has(file)) {
			continue;
		}
		for (const reference of literalToolingCartlibPaths(file, readFileSync(file, 'utf8'))) {
			const moduleId = reference.endsWith('.lua') ? reference.slice(0, -4) : reference;
			const target = moduleById.get(moduleId);
			if (target !== undefined) {
				byModule.get(target)!.add(file);
			}
		}
	}
	return new Map([...byModule].map(([file, consumers]) => [file, [...consumers].sort()]));
}

test('pre-CORE cartlib surface inventory exhaustively classifies the live module set', () => {
	assert.equal(inventory.version, 1);
	assert.equal(inventory.state, 'pre_core_baseline');
	const inventoryPaths = inventory.modules.map(module => module.current_path);
	assert.deepEqual(inventoryPaths, sortedUnique(inventoryPaths));
	assert.deepEqual(inventoryPaths, liveModules);
	assert.deepEqual(inventory.cart_projects, sortedUnique(inventory.cart_projects));

	const moveTargets: string[] = [];
	for (const module of inventory.modules) {
		assert.match(module.current_path, /^cartlib\/[A-Za-z0-9_\/-]+\.lua$/);
		assert.ok(module.final_owner.length > 0, `${module.current_path} has no final owner`);
		assert.ok(DISPOSITIONS.has(module.disposition), `${module.current_path} has an unknown disposition`);
		assert.ok(module.representation.length > 0, `${module.current_path} has no boundary representation`);
		assert.deepEqual(module.consumers.carts, sortedUnique(module.consumers.carts));
		assert.deepEqual(module.consumers.tooling, sortedUnique(module.consumers.tooling));
		const hotFunctionNames = module.hot_functions.map(hotFunction => hotFunction.name);
		assert.deepEqual(hotFunctionNames, sortedUnique(hotFunctionNames));
		assert.deepEqual(module.contract_tests, sortedUnique(module.contract_tests));
		for (const consumer of module.consumers.carts) {
			assert.ok(inventory.cart_projects.includes(consumer), `${module.current_path} names unknown cart ${consumer}`);
		}
		for (const contractTest of module.contract_tests) {
			assert.match(contractTest, /^tests\//);
			assert.equal(existsSync(contractTest), true, `${module.current_path} names missing test ${contractTest}`);
		}
		for (const hotFunction of module.hot_functions) {
			assert.ok(hotFunction.name.length > 0, `${module.current_path} has an unnamed hot function`);
			assert.deepEqual(hotFunction.tests, sortedUnique(hotFunction.tests));
			assert.equal(hotFunction.evidence, hotFunction.tests.length === 0 ? 'missing' : 'covered');
			for (const contractTest of hotFunction.tests) {
				assert.equal(module.contract_tests.includes(contractTest), true, `${module.current_path} omits hot-function test ${contractTest}`);
			}
		}
		if (module.disposition === 'move') {
			assert.match(module.target_path!, /^(?:cartlib|carts)\/[A-Za-z0-9_\/-]+\.lua$/);
			assert.equal(existsSync(module.target_path!), false, `${module.current_path} already coexists with its move target`);
			moveTargets.push(module.target_path!);
		} else {
			assert.equal(module.target_path, undefined, `${module.current_path} has a target without a move`);
		}
	}
	assert.equal(new Set(moveTargets).size, moveTargets.length);
});

test('cartlib surface inventory names every live cart and tooling consumer', () => {
	const cartConsumers = collectCartConsumers();
	const toolingConsumers = collectToolingConsumers();
	assert.deepEqual(inventory.cart_projects, cartConsumers.projects);
	for (const module of inventory.modules) {
		assert.deepEqual(module.consumers.carts, cartConsumers.byModule.get(module.current_path));
		assert.deepEqual(module.consumers.tooling, toolingConsumers.get(module.current_path));
	}
});
