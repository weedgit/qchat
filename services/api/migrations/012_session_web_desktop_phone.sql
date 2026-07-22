-- Remap legacy browser sessions that used device_type=desktop.
-- Electron keeps desktop when device_name mentions Desktop/Electron.
UPDATE sessions
SET device_type = 'web'
WHERE device_type = 'desktop'
  AND device_name NOT ILIKE '%desktop%'
  AND device_name NOT ILIKE '%electron%';
