package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
)

var allowedMedia = map[string]int64{
	"image/jpeg":      20 << 20,
	"image/png":       20 << 20,
	"image/gif":       20 << 20,
	"image/webp":      20 << 20,
	"application/pdf": 50 << 20,
	"text/plain":      5 << 20,
	"application/msword": 50 << 20,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": 50 << 20,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       50 << 20,
	"audio/webm": 10 << 20,
	"audio/ogg":  10 << 20,
	"audio/mpeg": 10 << 20,
	"audio/mp4":  10 << 20,
	"video/mp4":  200 << 20,
}

func (s *Server) uploadRoot() string {
	dir := s.cfg.DataDir
	if dir == "" {
		dir = "data"
	}
	return filepath.Join(dir, "uploads")
}

func (s *Server) handleMediaUpload(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if err := r.ParseMultipartForm(210 << 20); err != nil {
		writeErr(w, 400, "invalid multipart")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "file required")
		return
	}
	defer file.Close()
	kind := r.FormValue("kind")
	if kind == "" {
		kind = "file"
	}
	ct := hdr.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	max, ok := allowedMedia[ct]
	if !ok {
		writeErr(w, 400, "content type not allowed")
		return
	}
	if hdr.Size > max {
		writeErr(w, 400, "file too large")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, max+1))
	if err != nil || int64(len(data)) > max {
		writeErr(w, 400, "read failed or too large")
		return
	}
	sum := sha256.Sum256(data)
	key := filepath.Join(c.EnterpriseID, kind, uuid.NewString()+extFor(ct, hdr.Filename))
	root := s.uploadRoot()
	dir := filepath.Join(root, filepath.Dir(key))
	_ = os.MkdirAll(dir, 0o755)
	if err := os.WriteFile(filepath.Join(root, key), data, 0o644); err != nil {
		writeErr(w, 500, "store failed")
		return
	}
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO media_objects(id, enterprise_id, uploader_id, kind, content_type, size_bytes, storage_key, checksum, scanned)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
		id, c.EnterpriseID, c.UserID, kind, ct, len(data), key, hex.EncodeToString(sum[:]))
	if err != nil {
		writeErr(w, 500, "db failed")
		return
	}
	url := "/v1/media/files/" + filepath.ToSlash(key)
	writeJSON(w, 201, map[string]any{
		"id": id.String(), "url": url, "content_type": ct, "size": len(data), "kind": kind,
	})
}

func (s *Server) handleMediaGet(w http.ResponseWriter, r *http.Request) {
	// Allow Bearer header or ?token= for <img src> usage.
	if claimsFrom(r) == nil {
		token := r.URL.Query().Get("token")
		if token == "" {
			h := r.Header.Get("Authorization")
			if strings.HasPrefix(h, "Bearer ") {
				token = strings.TrimPrefix(h, "Bearer ")
			}
		}
		if token == "" {
			writeErr(w, 401, "unauthorized")
			return
		}
		claims, err := auth.ParseAccess(s.cfg.JWTSecret, token)
		if err != nil {
			writeErr(w, 401, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		r = r.WithContext(ctx)
	}
	c := claimsFrom(r)
	rel := r.PathValue("path")
	if rel == "" {
		rel = strings.TrimPrefix(r.URL.Path, "/v1/media/files/")
	}
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" || strings.Contains(rel, "..") {
		writeErr(w, 400, "invalid path")
		return
	}
	if !strings.HasPrefix(rel, c.EnterpriseID+"/") {
		writeErr(w, 403, "forbidden")
		return
	}
	full := filepath.Join(s.uploadRoot(), filepath.FromSlash(rel))
	if _, err := os.Stat(full); err != nil {
		writeErr(w, 404, "file not found")
		return
	}
	http.ServeFile(w, r, full)
}

func extFor(ct, name string) string {
	if strings.Contains(name, ".") {
		return filepath.Ext(name)
	}
	switch ct {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "video/mp4":
		return ".mp4"
	case "audio/mpeg":
		return ".mp3"
	case "audio/webm":
		return ".webm"
	case "audio/ogg":
		return ".ogg"
	case "audio/mp4":
		return ".m4a"
	default:
		return ""
	}
}

func (s *Server) handleCreateSpace(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	id := uuid.New()
	_, err := s.db.Exec(r.Context(), `INSERT INTO spaces(id, enterprise_id, name, created_by) VALUES ($1,$2,$3,$4)`,
		id, c.EnterpriseID, req.Name, c.UserID)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "name": req.Name})
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		SpaceID string `json:"space_id"`
		Title   string `json:"title"`
		Type    string `json:"type"` // public_channel|private_channel|announcement
	}
	if err := decodeJSON(r, &req); err != nil || req.Title == "" {
		writeErr(w, 400, "title required")
		return
	}
	if req.Type == "" {
		req.Type = "public_channel"
	}
	id := uuid.New()
	publicID := "C" + id.String()[:8]
	var space any
	if req.SpaceID != "" {
		space = req.SpaceID
	}
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO conversations(id, enterprise_id, type, title, public_id, owner_id, space_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, c.EnterpriseID, req.Type, req.Title, publicID, c.UserID, space)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,'owner', '-infinity')`, id, c.UserID)
	writeJSON(w, 201, map[string]any{"id": id.String(), "public_id": publicID, "type": req.Type})
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	convID := strings.TrimSpace(r.URL.Query().Get("conversation_id"))
	if q == "" {
		writeJSON(w, 200, map[string]any{"messages": []any{}, "users": []any{}})
		return
	}
	like := "%" + q + "%"
	// Mattermost-style post search scoped to membership; optional in-channel filter.
	var messages []map[string]any
	if convID != "" {
		mrows, _ := s.db.Query(r.Context(), `
			SELECT m.id::text, m.conversation_id::text, m.body, m.created_at
			FROM messages m
			JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
			WHERE m.enterprise_id=$2 AND m.conversation_id=$3 AND m.recalled=FALSE
			  AND m.body ILIKE $4 AND m.created_at >= cm.history_visible_from
			ORDER BY m.created_at DESC LIMIT 50`, c.UserID, c.EnterpriseID, convID, like)
		if mrows != nil {
			defer mrows.Close()
			for mrows.Next() {
				var id, cid, body string
				var created time.Time
				_ = mrows.Scan(&id, &cid, &body, &created)
				messages = append(messages, map[string]any{"id": id, "conversation_id": cid, "body": body, "created_at": created})
			}
		}
	} else {
		mrows, _ := s.db.Query(r.Context(), `
			SELECT m.id::text, m.conversation_id::text, m.body, m.created_at
			FROM messages m
			JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
			WHERE m.enterprise_id=$2 AND m.recalled=FALSE AND m.body ILIKE $3 AND m.created_at >= cm.history_visible_from
			ORDER BY m.created_at DESC LIMIT 30`, c.UserID, c.EnterpriseID, like)
		if mrows != nil {
			defer mrows.Close()
			for mrows.Next() {
				var id, cid, body string
				var created time.Time
				_ = mrows.Scan(&id, &cid, &body, &created)
				messages = append(messages, map[string]any{"id": id, "conversation_id": cid, "body": body, "created_at": created})
			}
		}
	}
	var users []map[string]any
	if convID == "" {
		urows, _ := s.db.Query(r.Context(), `
			SELECT id::text, username, display_name FROM users
			WHERE enterprise_id=$1 AND (username ILIKE $2 OR display_name ILIKE $2) LIMIT 20`, c.EnterpriseID, like)
		if urows != nil {
			defer urows.Close()
			for urows.Next() {
				var id, un, dn string
				_ = urows.Scan(&id, &un, &dn)
				users = append(users, map[string]any{"id": id, "username": un, "display_name": dn})
			}
		}
	}
	if messages == nil {
		messages = []map[string]any{}
	}
	if users == nil {
		users = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"messages": messages, "users": users})
}

func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if c.Role != "enterprise_admin" && c.Role != "platform_owner" {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		URL            string   `json:"url"`
		ConversationID string   `json:"conversation_id"`
		Events         []string `json:"events"`
	}
	if err := decodeJSON(r, &req); err != nil || req.URL == "" {
		writeErr(w, 400, "url required")
		return
	}
	id := uuid.New()
	secret := uuid.NewString()
	var conv any
	if req.ConversationID != "" {
		conv = req.ConversationID
	}
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO webhooks(id, enterprise_id, conversation_id, url, secret, events)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, c.EnterpriseID, conv, req.URL, secret, req.Events)
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "secret": secret})
}

func (s *Server) handleCreateBot(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	if c.Role != "enterprise_admin" && c.Role != "platform_owner" {
		writeErr(w, 403, "forbidden")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeErr(w, 400, "name required")
		return
	}
	token := uuid.NewString()
	id := uuid.New()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO bots(id, enterprise_id, name, token_hash) VALUES ($1,$2,$3,$4)`,
		id, c.EnterpriseID, req.Name, hashToken(token))
	if err != nil {
		writeErr(w, 500, "create failed")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id.String(), "token": token})
}
