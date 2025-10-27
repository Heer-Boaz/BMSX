#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '../../../');
const projTsconfig = path.resolve(__dirname, 'tsconfig.test.json');
const src = path.resolve(__dirname, 'project_src.ts');
const user = path.resolve(__dirname, 'project_a.ts');

// Create a minimal tsconfig for test project mode
const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Node',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: [src, user]
};
fs.writeFileSync(projTsconfig, JSON.stringify(tsconfig, null, 2));

console.log('Running project-mode converter with --flatten-instances on test project...');
execFileSync('node', [
  path.resolve(repo, 'scripts/ast-transform/convert_with_tsmorph.js'),
  '--project', projTsconfig, '--flatten-instances', src
], { stdio: 'inherit' });

// After conversion, ensure project_a import points to morph and contains named imports
const userTxt = fs.readFileSync(user, 'utf8');
if (!/from '\.\/project_src\.morph'/.test(userTxt)) {
  console.error('Expected import to be rewritten to .morph');
  process.exit(1);
}
if (!/\binit\b/.test(userTxt)) {
  console.error('Expected named import of init after rewrite');
  process.exit(2);
}

// Ensure new Demo(...) changed to init(...)
if (!/init\(10, 20\)/.test(userTxt)) {
  console.error('Expected new Demo(...) to be rewritten to init(10, 20)');
  process.exit(3);
}

// With flatten-instances, obj.doWork(2) -> doWork(2)
if (!/\bdoWork\(2\)/.test(userTxt)) {
  console.error('Expected obj.doWork(2) to be flattened to doWork(2)');
  process.exit(4);
}

console.log('Project-mode flatten-instances test passed.');
