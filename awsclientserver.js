const express = require('express');
var cPort = process.env.CLIENTPORT || 80;

express().use(express.static(__dirname + '/deploy'))
  .listen(cPort, () => console.log('Client server up on port ' + cPort + '.'));
