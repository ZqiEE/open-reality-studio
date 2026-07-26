'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const compiledRoot = process.argv[2];
const suite = process.argv[3];
const testPath = path.join(
  compiledRoot ? path.resolve(root, compiledRoot) : root,
  'tests',
  'releasegate',
  'releaseGate.test.js'
);

require(testPath);
