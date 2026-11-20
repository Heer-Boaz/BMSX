import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// A suite can select a completed build and run conformance without letting
// each runner reconfigure or write that CMake tree.
export function nativeConformanceRunner(target, {
	buildDirectory = 'build-cpp-tests',
	configure = [],
	parallel = '4',
} = {}) {
	const prebuilt = process.env.BMSX_TEST_NATIVE_BUILD_DIR;
	if (prebuilt !== undefined) return resolve(prebuilt, target);
	execFileSync('cmake', ['-S', 'machine/cpp', '-B', buildDirectory, '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON', ...configure], { stdio: 'inherit' });
	execFileSync('cmake', ['--build', buildDirectory, '--target', target, '--parallel', parallel], { stdio: 'inherit' });
	return resolve(buildDirectory, target);
}
