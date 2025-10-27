import { Demo, init, doWork, counter } from './project_src.morph';

init(10, 20);
const r1 = doWork(2);
const r2 = counter; // will be unsafe in real projects, but our conversion exposes top-level names

export { r1, r2 };
