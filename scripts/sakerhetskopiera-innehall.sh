#!/usr/bin/env bash
# Versionerar Arkitektens INNEHÅLL lokalt på servern – aldrig på GitHub.
#
# Processerna (flows/), ramserierna (ramar/) och underlagen (Input/) är
# verksamhetens och får inte spridas utanför (beslut 2026-10-07). De ligger
# därför i .gitignore i kodrepot och kopieras i stället hit, till ett eget
# git-repo UTAN FJÄRR, där varje körning blir en commit om något ändrats.
# En pre-push-krok i repot vägrar all push, så att ingen råkar koppla det
# till en fjärr.
#
# Körs varje natt av installationen (t.ex. en systemd-timer), och går att
# köra för hand:  scripts/sakerhetskopiera-innehall.sh
set -euo pipefail

ROT="$(cd "$(dirname "$0")/.." && pwd)"
MAL="${ARKITEKTEN_INNEHALL:-$HOME/arkitekten-innehall}"
# Installationens kataloger – samma miljövariabler som servern läser
# (server/installningar.ts), relativa till projektroten.
abs() { case "$1" in /*) echo "$1" ;; *) echo "$ROT/$1" ;; esac; }
declare -A MAPPAR=(
  [flows]="$(abs "${FLOWS_DIR:-flows}")"
  [ramar]="$(abs "${RAMAR_DIR:-ramar}")"
  [stilar]="$(abs "${STILAR_DIR:-stilar}")"
  [Input]="$ROT/Input"
  ["Rita flödesschema/Input"]="$ROT/Rita flödesschema/Input"
)

if [ ! -d "$MAL/.git" ]; then
  mkdir -p "$MAL"
  chmod 700 "$MAL"
  git -C "$MAL" init -q
  git -C "$MAL" config user.name "Arkitekten (säkerhetskopia)"
  git -C "$MAL" config user.email "arkitekten@localhost"
  cat > "$MAL/.git/hooks/pre-push" <<'KROK'
#!/bin/sh
echo "Arkitektens innehåll får inte lämna servern – push är spärrad." >&2
exit 1
KROK
  chmod +x "$MAL/.git/hooks/pre-push"
fi

for m in "${!MAPPAR[@]}"; do
  kalla="${MAPPAR[$m]}"
  [ -d "$kalla" ] || continue
  mkdir -p "$MAL/$m"
  rsync -a --delete "$kalla/" "$MAL/$m/"
done

git -C "$MAL" add -A
if git -C "$MAL" diff --cached --quiet; then
  echo "Inget nytt innehåll sedan förra kopian."
else
  git -C "$MAL" commit -q -m "Innehållet $(date '+%Y-%m-%d %H:%M')"
  echo "Sparade: $(git -C "$MAL" log --oneline -1)"
fi
