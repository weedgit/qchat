"use client";

import Link from "next/link";
import { SITE_CONTACTS } from "@/lib/contacts";
import { useLocale } from "@/lib/locale";

type SiteFooterProps = {
  /** Compact strip for login; full Contact us block for marketing pages */
  variant?: "full" | "compact";
  /** Show link back to sign-in (download page) */
  showLoginLink?: boolean;
};

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8.2 3.6c.4-.4 1-.5 1.5-.3l2.1.8c.6.2 1 .8.9 1.4l-.4 2.3a1.4 1.4 0 0 1-.8 1l-1.2.5a11.4 11.4 0 0 0 5.1 5.1l.5-1.2c.2-.5.7-.7 1.1-.8l2.3-.4c.6-.1 1.2.3 1.4.9l.8 2.1c.2.5.1 1.1-.3 1.5l-1.3 1.3c-.4.4-1 .6-1.6.5C10.8 18.6 5.4 13.2 4.1 6.7c-.1-.6.1-1.2.5-1.6L8.2 3.6z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function SiteFooter({
  variant = "full",
  showLoginLink = false,
}: SiteFooterProps) {
  const { t } = useLocale();
  const year = new Date().getFullYear();

  return (
    <footer className={`site-footer site-footer--${variant}`} id="contact">
      <div className="site-footer-inner">
        <div className="site-footer-head">
          <div className="site-footer-brand-block">
            <div className="site-footer-mark" aria-hidden>
              R
            </div>
            <div>
              <p className="site-footer-kicker">{t("footer.contactUs")}</p>
              <p className="site-footer-lead">{t("footer.lead")}</p>
            </div>
          </div>
          {variant === "full" && (
            <p className="site-footer-hours-note">{t("footer.hoursNote")}</p>
          )}
        </div>

        <ul className="site-footer-contacts">
          {SITE_CONTACTS.map((c, i) => (
            <li
              key={c.id}
              className="site-footer-contact"
              style={{ ["--sf-delay" as string]: `${i * 60}ms` }}
            >
              <div className="site-footer-contact-meta">
                <span className="site-footer-role">{t(c.roleKey)}</span>
                <span className="site-footer-name">{t(c.nameKey)}</span>
                {c.hoursKey && (
                  <span className="site-footer-hours">{t(c.hoursKey)}</span>
                )}
              </div>
              <a
                className="site-footer-phone"
                href={`tel:${c.phoneTel}`}
                aria-label={`${t(c.roleKey)} ${t(c.nameKey)} ${c.phoneDisplay}`}
              >
                <span className="site-footer-phone-icon">
                  <PhoneIcon />
                </span>
                <span className="site-footer-phone-num">{c.phoneDisplay}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="site-footer-bar">
          <span className="site-footer-copy">
            © {year} {t("app.name")}
          </span>
          {showLoginLink ? (
            <nav className="site-footer-nav" aria-label={t("footer.contactUs")}>
              <Link href="/login">{t("download.backToLogin")}</Link>
            </nav>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
