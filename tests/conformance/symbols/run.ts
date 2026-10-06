import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBlua32SymbolsImage, encodeBlua32SymbolsImage } from '../../../toolchain/ts/rompack/blua32_symbols';
import { compileLuaSource } from '../../lua/cpu_test_harness';
import { linkTestSystemBlua32 } from '../../helpers/blua32';

for (const args of [
	['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'],
	['--build', 'build-cpp-tests', '--target', 'bmsx_symbols_conformance_runner', '--parallel', '4'],
]) assert.equal(spawnSync('cmake', args, { stdio: 'inherit' }).status, 0);

const directory = mkdtempSync(join(tmpdir(), 'bmsx-symbols-'));
const source = `local seed = 3
local function factory(base)
  local offset = base
  return function(value)
    offset = offset + value
    return offset
  end
end
local increment<const> = function(value) return value + 1 end
local update = factory(seed)
return update(increment(seed))`;
const images = [0, 1, 2, 3].map(level => linkTestSystemBlua32(compileLuaSource(source, 'fixture/symbols-é.lua', level as 0 | 1 | 2 | 3)).symbols);
for (const path of process.argv.slice(2)) images.push(decodeBlua32SymbolsImage(readFileSync(path)));
for (let index = 0; index < images.length; index++) {
	const encoded = encodeBlua32SymbolsImage(images[index]);
	const expected = decodeBlua32SymbolsImage(encoded);
	const input = join(directory, `${index}.symbols`), output = join(directory, `${index}.native.symbols`);
	writeFileSync(input, encoded);
	const native = spawnSync('build-cpp-tests/bmsx_symbols_conformance_runner', [input, output], { encoding: 'utf8' });
	assert.equal(native.status, 0, native.stderr);
	assert.deepEqual(decodeBlua32SymbolsImage(readFileSync(output)), expected, `image ${index}; evidence ${directory}`);
}
rmSync(directory, { recursive: true });
console.log(`SYMBOLS-PARITY:PASS (${images.length} complete symbol graphs, TS -> C++ -> TS)`);
