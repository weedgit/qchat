package server

import (
	"net/http"
	"strconv"
	"time"
)

const (
	adminTrendsDefaultDays = 30
	adminTrendsMaxDays     = 183
)

type adminTrendPoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// handleAdminStatsTrends returns daily new-user and message counts for the
// overview chart. platform_admin sees the whole platform; enterprise_admin
// sees only their enterprise.
func (s *Server) handleAdminStatsTrends(w http.ResponseWriter, r *http.Request) {
	c := s.requirePerm(w, r, permAdminRead)
	if c == nil {
		return
	}

	days := adminTrendsDefaultDays
	if v, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && v > 0 {
		days = v
	}
	if days > adminTrendsMaxDays {
		days = adminTrendsMaxDays
	}

	since := time.Now().UTC().AddDate(0, 0, -(days - 1)).Truncate(24 * time.Hour)
	scope := `($1 = 'platform_admin' OR enterprise_id = $2::uuid)`
	scopeArgs := []any{normalizeRole(c.Role), entArg(c.EnterpriseID)}

	userCounts, err := s.adminDailyCounts(r, `
		SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int
		FROM users
		WHERE `+scope+` AND created_at >= $3
		GROUP BY 1
		ORDER BY 1`, append(scopeArgs, since)...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	msgCounts, err := s.adminDailyCounts(r, `
		SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int
		FROM messages
		WHERE `+scope+` AND created_at >= $3
		GROUP BY 1
		ORDER BY 1`, append(scopeArgs, since)...)
	if err != nil {
		writeErr(w, 500, "query failed")
		return
	}

	userSeries := fillAdminTrendSeries(since, days, userCounts)
	msgSeries := fillAdminTrendSeries(since, days, msgCounts)

	recentFrom, recentTo, prevFrom, prevTo := adminTrendSummaryBounds(days)

	writeJSON(w, 200, map[string]any{
		"days":     days,
		"users":    userSeries,
		"messages": msgSeries,
		"summary": map[string]any{
			"users_recent":      sumAdminTrendWindow(userSeries, recentFrom, recentTo),
			"users_previous":    sumAdminTrendWindow(userSeries, prevFrom, prevTo),
			"messages_recent":   sumAdminTrendWindow(msgSeries, recentFrom, recentTo),
			"messages_previous": sumAdminTrendWindow(msgSeries, prevFrom, prevTo),
			"recent_days":       recentTo - recentFrom,
			"previous_days":     prevTo - prevFrom,
		},
	})
}

func (s *Server) adminDailyCounts(r *http.Request, q string, args ...any) (map[string]int, error) {
	rows, err := s.db.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]int)
	for rows.Next() {
		var day time.Time
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		out[day.Format("2006-01-02")] = count
	}
	return out, rows.Err()
}

func fillAdminTrendSeries(since time.Time, days int, counts map[string]int) []adminTrendPoint {
	out := make([]adminTrendPoint, 0, days)
	for i := 0; i < days; i++ {
		d := since.AddDate(0, 0, i)
		key := d.Format("2006-01-02")
		out = append(out, adminTrendPoint{Date: key, Count: counts[key]})
	}
	return out
}

func sumAdminTrendWindow(series []adminTrendPoint, from, to int) int {
	if from < 0 {
		from = 0
	}
	if to > len(series) {
		to = len(series)
	}
	if from >= to {
		return 0
	}
	sum := 0
	for _, p := range series[from:to] {
		sum += p.Count
	}
	return sum
}

// adminTrendSummaryBounds picks comparison windows for the summary line:
// 7d → second half vs first half; ~1 month → last 7d vs prior 7d; 6mo → last 30d vs prior 30d.
func adminTrendSummaryBounds(days int) (recentFrom, recentTo, prevFrom, prevTo int) {
	recentTo = days
	switch {
	case days <= 7:
		mid := days / 2
		if mid < 1 {
			mid = 1
		}
		recentFrom = mid
		prevFrom = 0
		prevTo = mid
	case days <= 31:
		recentFrom = days - 7
		prevFrom = days - 14
		prevTo = days - 7
	default:
		recentFrom = days - 30
		prevFrom = days - 60
		prevTo = days - 30
	}
	return recentFrom, recentTo, prevFrom, prevTo
}
