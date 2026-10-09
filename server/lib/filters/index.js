'use strict';

// Every filter, in the order the UI lists them. Each definition has:
//   name, label, group, description
//   params:  controls the client renders (see range() / choice() in plan.js)
//   plan(width, height, params) -> Plan   for filters that run as OpenCL passes
//   run({ rgba, width, height, params }) -> Promise<Buffer>   for anything else
module.exports = [].concat(
  require('./blur'),
  require('./edges'),
  require('./colour'),
  require('./looks'),
  require('./stylize'),
  require('./retro'),
  require('./distort'),
  require('./adjust'),
  require('./generative'),
  require('./neural')
);
