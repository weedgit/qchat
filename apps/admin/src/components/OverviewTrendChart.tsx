"use client";

import { useMemo } from "react";
import type { MessageKey } from "@qchat/i18n";
import { useLocale } from "@/lib/locale";

export type TrendPoint = { date: string; count: number };

type Series = {
  id: string;
  label: string;
  color: string;
  points: TrendPoint[];
};

export const TREND_RANGES = [
  { days: 7, labelKey: "admin.overview.trend.range7" as const },
  { days: 30, labelKey: "admin.overview.trend.range30" as const },
  { days: 180, labelKey: "admin.overview.trend.range180" as const },
] as const;

export type TrendRangeDays = (typeof TREND_RANGES)[number]["days"];

type Props = {
  users: TrendPoint[];
  messages: TrendPoint[];
  loading?: boolean;
  rangeDays: TrendRangeDays;
  onRangeChange: (days: TrendRangeDays) => void;
  hintKey?: MessageKey;
};

const W = 720;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

function maxCount(points: TrendPoint[]): number {
  let m = 0;
  for (const p of points) if (p.count > m) m = p.count;
  return m;
}

function buildPath(points: TrendPoint[], max: number, y0: number, y1: number): string {
  if (points.length === 0 || max <= 0) return "";
  const innerW = W - PAD.left - PAD.right;
  const innerH = y1 - y0;
  return points
    .map((p, i) => {
      const x = PAD.left + (i / Math.max(1, points.length - 1)) * innerW;
      const y = y0 + innerH - (p.count / max) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatShortDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default function OverviewTrendChart({
  users,
  messages,
  loading,
  rangeDays,
  onRangeChange,
  hintKey = "admin.overview.trend.hint",
}: Props) {
  const { t, resolved } = useLocale();
  const locale = resolved === "zh" ? "zh-CN" : "en-US";

  const series: Series[] = useMemo(
    () => [
      {
        id: "users",
        label: t("admin.overview.trend.users"),
        color: "var(--accent, #3b82f6)",
        points: users,
      },
      {
        id: "messages",
        label: t("admin.overview.trend.messages"),
        color: "#22c55e",
        points: messages,
      },
    ],
    [users, messages, t]
  );

  const userMax = maxCount(users);
  const msgMax = maxCount(messages);
  const mid = PAD.top + (H - PAD.top - PAD.bottom) / 2;
  const topPath = buildPath(users, userMax, PAD.top, mid - 8);
  const botPath = buildPath(messages, msgMax, mid + 8, H - PAD.bottom);

  const ticks = useMemo(() => {
    if (users.length === 0) return [];
    const idx = [0, Math.floor(users.length / 2), users.length - 1];
    return Array.from(new Set(idx)).map((i) => ({
      x: PAD.left + (i / Math.max(1, users.length - 1)) * (W - PAD.left - PAD.right),
      label: formatShortDate(users[i]?.date ?? "", locale),
    }));
  }, [users, locale]);

  const gridStroke = "rgba(255, 255, 255, 0.1)";
  const gridRows = 4;

  function formatAxisValue(n: number): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  }

  function yAxisTicks(max: number, y0: number, y1: number) {
    const ticks: { y: number; value: number }[] = [];
    for (let i = 0; i <= gridRows; i++) {
      const y = y0 + ((y1 - y0) * i) / gridRows;
      const value =
        max <= 0 ? 0 : Math.round((max * (gridRows - i)) / gridRows);
      ticks.push({ y, value });
    }
    return ticks;
  }

  function horizontalGridLines(y0: number, y1: number, prefix: string) {
    const lines = [];
    for (let i = 0; i <= gridRows; i++) {
      const y = y0 + ((y1 - y0) * i) / gridRows;
      lines.push(
        <line
          key={`${prefix}-h-${i}`}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y}
          y2={y}
          stroke={gridStroke}
          strokeWidth="1"
        />
      );
    }
    return lines;
  }

  function yAxisLabels(max: number, y0: number, y1: number, prefix: string) {
    return yAxisTicks(max, y0, y1).map((tick, i) => (
      <text
        key={`${prefix}-y-${i}`}
        x={PAD.left - 6}
        y={tick.y + 4}
        textAnchor="end"
        fill="var(--text-faint)"
        fontSize="11"
      >
        {formatAxisValue(tick.value)}
      </text>
    ));
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div
        className="toolbar toolbar-full"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
      >
        <strong>{t("admin.overview.trend.title")}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="range-pills" role="group" aria-label={t("admin.overview.trend.range")}>
            {TREND_RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                className={`range-pill ${rangeDays === r.days ? "active" : ""}`}
                onClick={() => onRangeChange(r.days)}
                aria-pressed={rangeDays === r.days}
              >
                {t(r.labelKey)}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 16 }}>
            {series.map((s) => (
              <span key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: s.color,
                    display: "inline-block",
                  }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 15 }}>
        {t(hintKey)}
      </p>

      {loading ? (
        <div className="muted" style={{ padding: "48px 0", textAlign: "center" }}>
          {t("admin.common.loading")}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ minWidth: 320, display: "block" }}
            role="img"
            aria-label={t("admin.overview.trend.title")}
          >
            {horizontalGridLines(PAD.top, mid - 8, "users")}
            {yAxisLabels(userMax, PAD.top, mid - 8, "users")}
            {horizontalGridLines(mid + 8, H - PAD.bottom, "messages")}
            {yAxisLabels(msgMax, mid + 8, H - PAD.bottom, "messages")}
            {ticks.map((tick) => (
              <line
                key={`v-${tick.x}`}
                x1={tick.x}
                x2={tick.x}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={gridStroke}
                strokeWidth="1"
              />
            ))}
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={mid}
              y2={mid}
              stroke="var(--border, #334155)"
              strokeDasharray="4 4"
            />
            {topPath ? (
              <path d={topPath} fill="none" stroke={series[0].color} strokeWidth="2" />
            ) : null}
            {botPath ? (
              <path d={botPath} fill="none" stroke={series[1].color} strokeWidth="2" />
            ) : null}
            {ticks.map((tick) => (
              <text
                key={tick.label}
                x={tick.x}
                y={H - 6}
                textAnchor="middle"
                fill="var(--text-faint)"
                fontSize="12"
              >
                {tick.label}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

export function trendSummaryText(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  label: string,
  recent: number,
  previous: number,
  recentDays: number,
  previousDays: number
): { text: string; direction: "up" | "down" | "flat" | "new" } {
  const vars = { label, recent, previous, recentDays, previousDays };
  if (previous === 0 && recent === 0) {
    return { text: t("admin.overview.trend.flat", vars), direction: "flat" };
  }
  if (previous === 0) {
    return { text: t("admin.overview.trend.newActivity", vars), direction: "new" };
  }
  const pct = Math.round(((recent - previous) / previous) * 100);
  if (pct > 0) {
    return {
      text: t("admin.overview.trend.up", { ...vars, pct }),
      direction: "up",
    };
  }
  if (pct < 0) {
    return {
      text: t("admin.overview.trend.down", { ...vars, pct: Math.abs(pct) }),
      direction: "down",
    };
  }
  return { text: t("admin.overview.trend.steady", vars), direction: "flat" };
}
