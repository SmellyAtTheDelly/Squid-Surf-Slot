'use strict';

const { runCli } = require('./rtp-sim.js');

const args = process.argv.slice(2);
const ante = args[3] === 'ante';
if (ante) args.splice(3, 1);
if (!args.includes('--mode')) args.push('--mode', ante ? 'ante,buy' : 'base,buy');
console.error('rtp-exact.js is a compatibility entry point for full-round Monte Carlo, not exact analysis. The second positional argument now sets purchased rounds per choice.');
runCli(args);
