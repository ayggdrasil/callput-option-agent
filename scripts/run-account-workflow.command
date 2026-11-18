#!/bin/zsh -l
SCRIPT_DIR="${0:A:h}"
exec node "$SCRIPT_DIR/run-account-workflow.mjs"
