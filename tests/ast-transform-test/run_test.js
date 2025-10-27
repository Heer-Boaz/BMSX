#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repo = path.resolve(__dirname, '../../../');
const input = path.resolve(__dirname, 'fixture.input.ts');

console.log('Running ts-morph converter on fixture...');
execFileSync('node', [path.resolve(repo, 'scripts/ast-transform/convert_with_tsmorph.js'), input], { stdio: 'inherit' });

const out = input.replace(/\.ts$/, '.morph.ts');
if (!fs.existsSync(out)) {
  console.error('Output file not generated:', out);
  process.exit(1);
}
const txt = fs.readFileSync(out, 'utf8');
if (!/export const DemoStatics/.test(txt)) {
  console.error('Expected DemoStatics in output.');
  process.exit(2);
}
if (!/export const ID/.test(txt) && !/export const ID: number = 7;/.test(txt)) {
  console.error('Expected exported const ID in output.');
  process.exit(3);
}
if (!/function init\(/.test(txt)) {
  console.error('Expected function init in output.');
  process.exit(4);
}
console.log('ts-morph conversion test passed. Output:', out);
