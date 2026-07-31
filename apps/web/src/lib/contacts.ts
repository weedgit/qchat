/** Public support contacts shown in the site footer. Edit phones here. */
export type SiteContact = {
  id: string;
  /** i18n role label key */
  roleKey:
    | "footer.roleSupport"
    | "footer.roleTech"
    | "footer.roleSales"
    | "footer.roleAccounts";
  /** i18n desk / title name */
  nameKey:
    | "footer.nameSupport"
    | "footer.nameTech"
    | "footer.nameSales"
    | "footer.nameAccounts";
  /** Digits / + for tel: href */
  phoneTel: string;
  /** Human-readable phone */
  phoneDisplay: string;
  /** Optional hours note key */
  hoursKey?: "footer.hoursWeekday" | "footer.hoursAlways";
};

export const SITE_CONTACTS: SiteContact[] = [
  {
    id: "support",
    roleKey: "footer.roleSupport",
    nameKey: "footer.nameSupport",
    phoneTel: "4006120888",
    phoneDisplay: "400-612-0888",
    hoursKey: "footer.hoursAlways",
  },
  {
    id: "tech",
    roleKey: "footer.roleTech",
    nameKey: "footer.nameTech",
    phoneTel: "4006120889",
    phoneDisplay: "400-612-0889",
    hoursKey: "footer.hoursWeekday",
  },
  {
    id: "sales",
    roleKey: "footer.roleSales",
    nameKey: "footer.nameSales",
    phoneTel: "+862158881200",
    phoneDisplay: "021-5888-1200",
    hoursKey: "footer.hoursWeekday",
  },
  {
    id: "accounts",
    roleKey: "footer.roleAccounts",
    nameKey: "footer.nameAccounts",
    phoneTel: "13800138001",
    phoneDisplay: "138-0013-8001",
    hoursKey: "footer.hoursWeekday",
  },
];
