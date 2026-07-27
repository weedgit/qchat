package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var giphyHTTP = &http.Client{Timeout: 8 * time.Second}

type giphyImage struct {
	URL string `json:"url"`
}

type giphyImages struct {
	Original          giphyImage `json:"original"`
	Downsized         giphyImage `json:"downsized"`
	FixedHeightSmall  giphyImage `json:"fixed_height_small"`
	FixedWidthSmall   giphyImage `json:"fixed_width_small"`
	PreviewGif        giphyImage `json:"preview_gif"`
}

type giphyItem struct {
	ID     string      `json:"id"`
	Title  string      `json:"title"`
	Images giphyImages `json:"images"`
}

type giphyResponse struct {
	Data []giphyItem `json:"data"`
}

// handleGifSearch proxies Giphy search/trending so the API key stays server-side.
// GET /v1/gifs?q=optional
func (s *Server) handleGifSearch(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(s.cfg.GiphyAPIKey)
	if key == "" {
		writeErrCode(w, 503, "giphy_not_configured",
			"GIF search is not configured. Set QCHAT_GIPHY_API_KEY (free key from developers.giphy.com).")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 24
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	endpoint := "https://api.giphy.com/v1/gifs/trending"
	params := url.Values{}
	params.Set("api_key", key)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("rating", "pg-13")
	if q != "" {
		endpoint = "https://api.giphy.com/v1/gifs/search"
		params.Set("q", q)
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		writeErrCode(w, 500, "giphy_request_failed", "GIF search failed")
		return
	}
	res, err := giphyHTTP.Do(req)
	if err != nil {
		writeErrCode(w, 502, "giphy_unreachable", "GIF provider unreachable")
		return
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		writeErrCode(w, 502, "giphy_read_failed", "GIF search failed")
		return
	}
	if res.StatusCode >= 400 {
		writeErrCode(w, 502, "giphy_error", fmt.Sprintf("GIF provider error (%d)", res.StatusCode))
		return
	}

	var parsed giphyResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		writeErrCode(w, 502, "giphy_invalid", "GIF provider returned invalid data")
		return
	}

	out := make([]map[string]any, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		preview := firstNonEmpty(
			item.Images.FixedHeightSmall.URL,
			item.Images.FixedWidthSmall.URL,
			item.Images.PreviewGif.URL,
			item.Images.Downsized.URL,
			item.Images.Original.URL,
		)
		full := firstNonEmpty(
			item.Images.Downsized.URL,
			item.Images.Original.URL,
			item.Images.FixedHeightSmall.URL,
			preview,
		)
		if preview == "" || full == "" {
			continue
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = "GIF"
		}
		out = append(out, map[string]any{
			"id":          item.ID,
			"title":       title,
			"preview_url": preview,
			"url":         full,
		})
	}
	writeJSON(w, 200, map[string]any{"gifs": out})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
