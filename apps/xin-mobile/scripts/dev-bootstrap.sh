# XinChat mobile local dev bootstrap (no EAS login required).

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — review EXPO_PUBLIC_* URLs"
fi

npm ci
npm run typecheck
npm run check:release

echo ""
echo "Dev: npx expo start"
echo "EAS: npm run eas:onboard   (requires npm run eas:login)"
