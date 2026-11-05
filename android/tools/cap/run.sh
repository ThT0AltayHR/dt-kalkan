#!/bin/bash
# usage: run.sh <outdir> [only]
E=/workspace/projects/9dab082a-b547-41c5-b865-4a648a7c029f/app/node_modules/electron/dist/electron
cd "$(dirname "$0")"
DT_DSF=${DT_DSF:-2} ELECTRON_DISABLE_SECURITY_WARNINGS=true xvfb-run -a -s "-screen 0 1280x2000x24" $E --no-sandbox --disable-gpu capture.js "$1" "$2" 2>&1 | grep -E "^\[(cap|page)\]" 
