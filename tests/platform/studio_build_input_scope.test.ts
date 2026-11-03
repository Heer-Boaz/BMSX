import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { StudioBuildJobs } from '../../hosts/node/builds/jobs';
import { isBuildTerminal, type StudioBuildJob, type StudioBuildRequest } from '../../hosts/common/studio_builds';
import { WorkspaceProjects } from '../../hosts/node/workspace/projects';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';

const POSITIONS = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);

/** The actual cooker must consume the named external bytes for this mesh. */
function model(uri: string): string {
	return JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri, byteLength: POSITIONS.length }],
		bufferViews: [{ buffer: 0, byteLength: POSITIONS.length }],
		accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }],
		scenes: [{ nodes: [0] }], scene: 0 });
}

test('Studio build input authority contains GLTF references and filesystem symlinks to its workspace', { timeout: 120_000 }, async t => {
	const base = await mkdtemp(join(tmpdir(), 'bmsx-build-scope-'));
	const workspace = join(base, 'workspace'), cart = join(workspace, 'carts', 'sample'), resources = join(cart, 'res');
	// A textual path prefix is not a workspace authority: this is a sibling.
	const outsideRoot = join(base, 'workspace-other'), outside = join(outsideRoot, 'private.bin'), mesh = join(resources, 'mesh.gltf');
	await mkdir(resources, { recursive: true });
	await mkdir(outsideRoot);
	// Product BIOS is an actual compiler dependency, not a mutable gameplay cart.
	await cp(join(process.cwd(), 'machine', 'bios'), join(workspace, 'machine', 'bios'), { recursive: true });
	const git = spawnSync('git', ['init', '-q'], { cwd: workspace, encoding: 'utf8' });
	assert.equal(git.status, 0, git.stderr);
	await writeFile(join(cart, 'entry.lua'), 'module<entry>\nreturn true\n');
	await writeFile(join(resources, 'sample.rommanifest'), 'title: Sample\nhardware:\n  - type: rom\n');
	await writeFile(outside, POSITIONS);
	const projects = new WorkspaceProjects(workspace, join(base, 'projects'));
	// Workspace admission canonicalizes once, even when opened through an alias.
	const alias = join(base, 'workspace-alias');
	await symlink(workspace, alias, 'dir');
	const jobs = await StudioBuildJobs.open(alias, join(base, 'jobs'), projects);
	t.after(async () => { await jobs.close(); await projects.close(); await rm(base, { recursive: true, force: true }); });
	const build = async (): Promise<StudioBuildJob> => {
		const request: StudioBuildRequest = { requestId: randomUUID(), target: 'sample', debug: true, optLevel: 0 };
		const completed = Promise.withResolvers<StudioBuildJob>();
		const stop = jobs.subscribe(({ job }) => {
			if (job.request.requestId === request.requestId && isBuildTerminal(job.state)) completed.resolve(job);
		});
		try { await jobs.admit(request); return await completed.promise; } finally { stop(); }
	};

	// Escaping through a GLTF URI must not become a public build artifact.
	await writeFile(mesh, model(relative(resources, outside).replace(/\\/g, '/')));
	const escapedReference = await build();
	assert.equal(escapedReference.state, 'failed', escapedReference.error);
	assert.match(escapedReference.error!, /outside the workspace/);
	assert.equal(escapedReference.artifact, undefined);

	// A source file that is itself a link to an outside model is equally unauthorized.
	const outsideModel = join(outsideRoot, 'model.gltf');
	await writeFile(outsideModel, model('private.bin'));
	await rm(mesh); await symlink(outsideModel, mesh);
	const escapedLink = await build();
	assert.equal(escapedLink.state, 'failed', escapedLink.error);
	assert.match(escapedLink.error!, /outside the workspace/);
	assert.equal(escapedLink.artifact, undefined);

	// Directory traversal must be admitted before discovering any children.
	await rm(mesh);
	const outsideDirectory = join(base, 'outside-models'), directoryLink = join(resources, 'outside-models');
	await mkdir(outsideDirectory); await writeFile(join(outsideDirectory, 'mesh.gltf'), model('../private.bin'));
	await symlink(outsideDirectory, directoryLink, 'dir');
	const escapedDirectory = await build();
	assert.equal(escapedDirectory.state, 'failed', escapedDirectory.error);
	assert.match(escapedDirectory.error!, /outside the workspace/);
	assert.equal(escapedDirectory.artifact, undefined);
	await rm(directoryLink);

	// Authored Lua is captured under the same authority, not just assets.
	const outsideLua = join(base, 'private.lua'), sourceLink = join(cart, 'outside.lua');
	await writeFile(outsideLua, 'return true\n'); await symlink(outsideLua, sourceLink);
	const escapedSource = await build();
	assert.equal(escapedSource.state, 'failed', escapedSource.error);
	assert.match(escapedSource.error!, /outside the workspace/);
	assert.equal(escapedSource.artifact, undefined);
	await rm(sourceLink);

	// The toolchain identity also reads files while the worker is running.
	const toolchain = join(workspace, 'scripts', 'rompacker');
	const outsideTool = join(base, 'private.ts'), toolLink = join(toolchain, 'outside.ts');
	await mkdir(toolchain, { recursive: true }); await writeFile(outsideTool, 'export const value = 1;\n');
	await symlink(outsideTool, toolLink);
	const escapedToolchain = await build();
	assert.equal(escapedToolchain.state, 'failed', escapedToolchain.error);
	assert.match(escapedToolchain.error!, /outside the workspace/);
	assert.equal(escapedToolchain.artifact, undefined);
	await rm(toolLink);

	// A link and dependency outside res, but inside the authorized workspace, remain usable.
	const shared = join(workspace, 'shared');
	await mkdir(shared); await writeFile(join(shared, 'model.gltf'), model('../geometry.bin'));
	await writeFile(join(cart, 'geometry.bin'), POSITIONS);
	await symlink(join(shared, 'model.gltf'), mesh);
	const admitted = await build();
	assert.equal(admitted.state, 'completed', admitted.error);
	const artifact = await jobs.artifacts.read(admitted.artifact!);
	assert.ok((await readFile(join(jobs.artifacts.directory(artifact.id), artifact.cart!.outputs[0].file))).length > 0);

	// Cache identity must not authorize a changed location, even with identical bytes.
	const geometry = join(cart, 'geometry.bin');
	await rm(geometry); await symlink(outside, geometry);
	const escapedCachedInput = await build();
	assert.equal(escapedCachedInput.state, 'failed', escapedCachedInput.error);
	assert.match(escapedCachedInput.error!, /outside the workspace/);
	assert.equal(escapedCachedInput.artifact, undefined);
	await rm(geometry); await writeFile(geometry, POSITIONS);
	const cached = await build();
	assert.equal(cached.state, 'completed', cached.error);
	assert.equal(cached.artifact, admitted.artifact);
});

test('standalone ROM input capture retains explicit external dependency access', async t => {
	const base = await mkdtemp(join(tmpdir(), 'bmsx-cli-scope-'));
	t.after(() => rm(base, { recursive: true, force: true }));
	const resources = join(base, 'project', 'res'), dependency = join(base, 'external.bin');
	await mkdir(resources, { recursive: true }); await writeFile(dependency, POSITIONS);
	await writeFile(join(resources, 'mesh.gltf'), model(relative(resources, dependency).replace(/\\/g, '/')));
	const inputs = await prepareRomInputs([resources], [], { kind: 'filesystem' });
	assert.deepEqual(inputs.files.get(dependency)!.bytes, POSITIONS);
});
