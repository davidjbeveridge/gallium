#!/usr/bin/env node
import { launch } from './launch.mjs';
launch('src/cli.ts', process.argv.slice(2));
