#!/bin/zsh -l
SCRIPT_DIR="${0:A:h}"
if [[ ! -f "$HOME/Library/Application Support/CallputSigner/owner.json" ]]; then
  node "$SCRIPT_DIR/setup-local-keystore.mjs" || exit 1
fi
exec node "$SCRIPT_DIR/run-sponsored-trade.mjs" robinhood
