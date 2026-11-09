#!/bin/sh
# Startar Arkitekten (eller flödestjänsten) som användaren node.
#
# Med docker compose äger node redan volymen /data (avbilden skapar den så),
# eller så kör installationen containern som en vald användare (user:) – då
# körs kommandot rakt av. Startar containern som root, som på plattformar där
# disken monteras först vid start (Render), får node först äga /data.
# En skrivskyddad montering (flödestjänstens) rörs aldrig.
set -eu

if [ "$(id -u)" = 0 ]; then
    data=${ARK_DATA:-/data}
    if [ -d "$data" ] && [ -w "$data" ] && [ "$(stat -c %u "$data")" != "$(id -u node)" ]; then
        echo "[start] $data ägs inte av node – rättar ägaren."
        chown -R node:node "$data"
    fi
    exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
