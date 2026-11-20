import { run } from 'node:test';
import { tap } from 'node:test/reporters';

// Use one browser worker with private contexts and authored workspaces.
// Node 22's CLI forces concurrency=1 with test isolation disabled.
const matrix = run({
	isolation: 'none',
	concurrency: 6,
	files: [
		'studio_program_tools', 'studio_actor_execution_tools', 'studio_assistant',
		'studio_actor_tools', 'studio_assistant_presentation', 'studio_assistant_images',
		'studio_behavior_tools', 'studio_debugger_tools', 'studio_frame_tools', 'studio_navigation_tools',
		'studio_runtime_tools', 'studio_source_save_tools', 'studio_stack_tools', 'studio_terminal_tools',
		'studio_test_debugger_tools', 'studio_test_execution_tools', 'studio_test_inspection_tools',
	].map(name => `tests/platform/${name}.test.ts`),
});
matrix.on('test:fail', () => { process.exitCode = 1; });
matrix.compose(tap).pipe(process.stdout);
