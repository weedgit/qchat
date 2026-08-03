-- China-mainland push: Getui CID + OEM platforms (Honor/Meizu).
-- push_devices.platform is free-form TEXT; document allowed values.
COMMENT ON COLUMN push_devices.platform IS
  'web|ios|android|getui|huawei|xiaomi|oppo|vivo|honor|meizu';
