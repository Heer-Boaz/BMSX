import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Machine } from '../../../machine/ts/machine/machine';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { GEO_STATUS_DONE } from '../../../machine/ts/machine/devices/geometry/contracts';
import { cartridgeSlots } from '../../helpers/cartridge';
import { geometryVectors } from './vectors';

const command = process.argv.slice(2);
if (command.length === 0) {
	for (const args of [
		['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'],
		['--build', 'build-cpp-tests', '--target', 'bmsx_geometry_conformance_runner', '--parallel', '4'],
	]) assert.equal(spawnSync('cmake', args, { stdio: 'inherit' }).status, 0);
	command.push('build-cpp-tests/bmsx_geometry_conformance_runner');
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-geometry-'));
const vectors = geometryVectors();
const path = join(directory, 'vectors.txt');
writeFileSync(path, vectors.map(v => [v.writes.length, ...v.writes.flat(), v.reads.length, ...v.reads].join(' ')).join('\n'));
const native = spawnSync(command[0], [...command.slice(1), path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const rows = native.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
assert.equal(rows.length, vectors.length);
const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
const machine = new Machine(memory, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {} }, PSX_MACHINE_SPEC);
for (let i = 0; i < vectors.length; i++) {
	const v = vectors[i];
	machine.resetDevices();
	machine.geometryController.setTiming(1, 1, 0);
	for (const [address, word] of v.writes) memory.writeMappedWord(address, word);
	machine.geometryController.accrueCycles(1000, 1000);
	machine.geometryController.onService(1000);
	const expected = v.reads.map(address => memory.readMappedWord(address));
	assert.equal(expected[0], GEO_STATUS_DONE, v.name);
	assert.deepEqual(rows[i], expected, `${v.name}: raw result/status words; evidence ${directory}`);
}
assert.equal(rows[0][12], 1, 'ordinary overlapping polygons publish a contact');
assert.equal(rows[1][12], 0, 'overlap excludes touching boundaries');
assert.equal(rows[5][3], 1, 'SAT publishes a hit');
assert.equal(rows[5][6], 3 * 65536, 'SAT depth stays Q16.16');
rmSync(directory, { recursive: true });
console.log(`GEO-PARITY:PASS (${vectors.length} RAM/MMIO vectors)`);
