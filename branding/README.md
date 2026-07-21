# Qchat brand icon

`qchat-icon-512.png` is the canonical icon source for every Qchat client.

After replacing it, regenerate checked-in platform assets:

```bash
./scripts/sync-brand-icons.sh
```

The script uses ImageMagick and writes real files into each application so
Electron packaging, Next.js exports, and future Flutter builds do not depend on
cross-directory symlinks.
