Browser graph-layout.worker.js includes elkjs 0.12.0 byte-for-byte.
Node graph-layout.node-worker.cjs bundles the same upstream endpoint plus
the BMSX Node transport bridge. The upstream engine is by Kiel
University and other Eclipse Layout Kernel contributors. Distributed under
the Eclipse Public License 2.0; see elkjs.LICENSE.txt supplied with this product.

Source revision recorded in the published package metadata:
https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c
Exact published package (JavaScript, typings and copyright notices):
https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz

The browser Studio UI, Node main thread and BMSX machine do not contain the
ELK engine. Node worker bundling changes packaging, not the upstream code.
