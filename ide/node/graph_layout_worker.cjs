// Node's native thread owns the upstream in-process worker endpoint. This is a
// transport bridge for ELK's existing protocol, not another graph/layout API.
const { parentPort } = require('node:worker_threads');
const { Worker: ElkWorker } = require('elkjs/lib/elk-worker.min.js');
const elk = new ElkWorker();
elk.onmessage = event => parentPort.postMessage(event.data);
parentPort.on('message', data => elk.postMessage(data));
