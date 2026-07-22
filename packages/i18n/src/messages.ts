/** Shared UI catalogs — English + Simplified Chinese. */

export type LocaleMode = "en" | "zh" | "system";
export type ResolvedLocale = "en" | "zh";

export type MessageKey = keyof typeof en;

const en = {
  "app.name": "Qchat",

  "nav.chats": "Chats",
  "nav.contacts": "Contacts",
  "nav.me": "Me",
  "nav.settings": "Settings",
  "nav.groups": "Groups",
  "nav.menu": "Menu",
  "nav.profile": "My profile",
  "nav.logOut": "Log Out",
  "nav.signOut": "Sign out",

  "appearance.title": "Appearance",
  "appearance.hint": "Theme and language",
  "appearance.theme": "Theme",
  "appearance.language": "Language",

  "theme.dark": "Dark",
  "theme.light": "Light",
  "theme.system": "System",

  "lang.en": "English",
  "lang.zh": "简体中文",
  "lang.system": "System",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saved": "Saved",
  "common.search": "Search",
  "common.reconnecting": "Reconnecting…",
  "common.loading": "Loading…",
  "common.error": "Something went wrong",

  "status.online": "Online",
  "status.away": "Away",
  "status.dnd": "Do not disturb",
  "status.offline": "Offline",
  "status.label": "Status",

  "menu.contacts": "Contacts",
  "menu.groups": "Groups",
  "menu.settings": "Settings",
  "menu.theme": "Theme",
  "menu.language": "Language",
  "menu.joinCompany": "Join a company",
  "menu.newGroup": "New Group",
  "menu.newPrivateChat": "New Private Chat",

  "settings.title": "Settings",
  "settings.subtitle": "notifications & security",
  "settings.notifications": "Notifications",
  "settings.notificationsHint": "Desktop and sound preferences",
  "settings.desktopNotifications": "Desktop notifications",
  "settings.notifyAll": "All new messages",
  "settings.notifyMention": "Mentions only",
  "settings.notifyNone": "Nothing",
  "settings.playSound": "Play notification sound",
  "settings.mentionsOnly": "Mentions only",
  "settings.saveNotifications": "Save notifications",
  "settings.sessions": "Login sessions",
  "settings.sessionsHint":
    "One web, one desktop, and one phone session. Location is estimated from IP.",
  "settings.noSessions": "No active sessions.",
  "settings.thisDevice": "This device",
  "settings.revoke": "Revoke",
  "settings.changePhone": "Change phone number",
  "settings.currentPhone": "Current",
  "settings.newPhone": "New 11-digit phone",
  "settings.sendSms": "Send SMS code",
  "settings.verifyCode": "Verification code",
  "settings.confirmPhone": "Confirm phone change",
  "settings.about": "About",
  "settings.apiServer": "API server",
  "settings.signOutConfirmTitle": "Sign out",
  "settings.signOutConfirmBody": "Sign out of this account?",
  "settings.unknownLocation": "Unknown location",
  "settings.lastActive": "Last active",

  "login.title": "Sign in",
  "login.register": "Register",
  "login.phone": "Phone",
  "login.password": "Password",
  "login.username": "Username",
  "login.captcha": "Captcha",
  "login.smsCode": "SMS code",
  "login.sendCode": "Send code",
  "login.submitLogin": "Sign in",
  "login.submitRegister": "Create account",
  "login.remember": "Remember me",
  "login.switchToRegister": "Need an account? Register",
  "login.switchToLogin": "Have an account? Sign in",

  "me.title": "Me",
  "me.editProfile": "Edit profile",
} as const;

const zh: Record<MessageKey, string> = {
  "app.name": "Qchat",

  "nav.chats": "聊天",
  "nav.contacts": "通讯录",
  "nav.me": "我",
  "nav.settings": "设置",
  "nav.groups": "群组",
  "nav.menu": "菜单",
  "nav.profile": "我的资料",
  "nav.logOut": "退出登录",
  "nav.signOut": "退出登录",

  "appearance.title": "外观",
  "appearance.hint": "主题与语言",
  "appearance.theme": "主题",
  "appearance.language": "语言",

  "theme.dark": "深色",
  "theme.light": "浅色",
  "theme.system": "跟随系统",

  "lang.en": "English",
  "lang.zh": "简体中文",
  "lang.system": "跟随系统",

  "common.cancel": "取消",
  "common.save": "保存",
  "common.saved": "已保存",
  "common.search": "搜索",
  "common.reconnecting": "重新连接中…",
  "common.loading": "加载中…",
  "common.error": "出错了",

  "status.online": "在线",
  "status.away": "离开",
  "status.dnd": "勿扰",
  "status.offline": "离线",
  "status.label": "状态",

  "menu.contacts": "通讯录",
  "menu.groups": "群组",
  "menu.settings": "设置",
  "menu.theme": "主题",
  "menu.language": "语言",
  "menu.joinCompany": "加入企业",
  "menu.newGroup": "新建群聊",
  "menu.newPrivateChat": "发起私聊",

  "settings.title": "设置",
  "settings.subtitle": "通知与安全",
  "settings.notifications": "通知",
  "settings.notificationsHint": "桌面与声音偏好",
  "settings.desktopNotifications": "桌面通知",
  "settings.notifyAll": "所有新消息",
  "settings.notifyMention": "仅提及",
  "settings.notifyNone": "不通知",
  "settings.playSound": "播放通知声音",
  "settings.mentionsOnly": "仅提及",
  "settings.saveNotifications": "保存通知设置",
  "settings.sessions": "登录会话",
  "settings.sessionsHint": "网页、桌面、手机各保留一个会话。位置由 IP 估算。",
  "settings.noSessions": "暂无活跃会话。",
  "settings.thisDevice": "本机",
  "settings.revoke": "撤销",
  "settings.changePhone": "更换手机号",
  "settings.currentPhone": "当前",
  "settings.newPhone": "新手机号（11 位）",
  "settings.sendSms": "发送验证码",
  "settings.verifyCode": "验证码",
  "settings.confirmPhone": "确认更换",
  "settings.about": "关于",
  "settings.apiServer": "API 服务器",
  "settings.signOutConfirmTitle": "退出登录",
  "settings.signOutConfirmBody": "确定退出当前账号？",
  "settings.unknownLocation": "未知位置",
  "settings.lastActive": "最近活跃",

  "login.title": "登录",
  "login.register": "注册",
  "login.phone": "手机号",
  "login.password": "密码",
  "login.username": "用户名",
  "login.captcha": "验证码",
  "login.smsCode": "短信验证码",
  "login.sendCode": "发送验证码",
  "login.submitLogin": "登录",
  "login.submitRegister": "创建账号",
  "login.remember": "记住我",
  "login.switchToRegister": "没有账号？去注册",
  "login.switchToLogin": "已有账号？去登录",

  "me.title": "我",
  "me.editProfile": "编辑资料",
};

export const catalogs: Record<ResolvedLocale, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  zh,
};

export const LOCALE_KEY = "qchat.locale";

export function isLocaleMode(v: string | null | undefined): v is LocaleMode {
  return v === "en" || v === "zh" || v === "system";
}

export function resolveLocale(
  mode: LocaleMode,
  systemLang?: string | null
): ResolvedLocale {
  if (mode === "en" || mode === "zh") return mode;
  const sys = (systemLang || "").toLowerCase();
  if (sys.startsWith("zh")) return "zh";
  return "en";
}

export function translate(
  locale: ResolvedLocale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  let s = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function localeModeLabel(mode: LocaleMode, resolved: ResolvedLocale): string {
  if (mode === "system") return catalogs[resolved]["lang.system"];
  if (mode === "zh") return catalogs[resolved]["lang.zh"];
  return catalogs[resolved]["lang.en"];
}

export function themeModeLabel(
  mode: "dark" | "light" | "system",
  locale: ResolvedLocale
): string {
  if (mode === "dark") return catalogs[locale]["theme.dark"];
  if (mode === "light") return catalogs[locale]["theme.light"];
  return catalogs[locale]["theme.system"];
}
