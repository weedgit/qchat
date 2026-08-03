package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/blobstore"
)

var (
	maxAvatarBytes = int64(100 << 20) // requirements: avatar ≤ 100 MB
	maxFileBytes   = int64(100 << 20)
	maxVideoBytes  = int64(200 << 20)
	maxVoiceBytes  = int64(10 << 20) // ~60s recorded voice
)

// allowedAvatarTypes are raster formats named by requirements-en §2.2 (JPG/PNG/GIF)
// plus WebP. SVG is excluded: image/svg+xml is scriptable and would be served from
// the same origin as the app when used as an avatar.
var allowedAvatarTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// allowedAvatarContentType reports whether ct is a permitted avatar MIME type.
func allowedAvatarContentType(ct string) bool {
	return allowedAvatarTypes[strings.ToLower(strings.TrimSpace(ct))]
}

// maxUploadBytes sizes by kind. Any content type is accepted for chat attachments.
func maxUploadBytes(kind, contentType string) int64 {
	switch kind {
	case "avatar":
		return maxAvatarBytes
	case "voice":
		return maxVoiceBytes
	case "video":
		return maxVideoBytes
	case "image":
		return maxFileBytes
	default:
		if strings.HasPrefix(contentType, "video/") {
			return maxVideoBytes
		}
		return maxFileBytes
	}
}

func (s *Server) uploadRoot() string {
	dir := s.cfg.DataDir
	if dir == "" {
		dir = "data"
	}
	return filepath.Join(dir, "uploads")
}

func (s *Server) blobStore() blobstore.Store {
	if s.blobs != nil {
		return s.blobs
	}
	return blobstore.NewLocal(s.cfg.DataDir)
}

func (s *Server) handleMediaUpload(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	// Keep most of the multipart in temp files so large uploads don't pin RAM.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
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
	ct = strings.ToLower(ct)
	// Avatars: whitelist raster types only (no SVG). Size capped at 100 MB.
	if kind == "avatar" {
		if !allowedAvatarContentType(ct) {
			writeErr(w, 400, "avatar must be jpeg, png, gif, or webp")
			return
		}
		// Reject SVG even when the client lies about Content-Type but keeps a
		// .svg filename — ServeFile would then label the response as SVG.
		ext := strings.ToLower(filepath.Ext(hdr.Filename))
		if ext == ".svg" || ext == ".svgz" {
			writeErr(w, 400, "avatar must be jpeg, png, gif, or webp")
			return
		}
	}
	max := maxUploadBytes(kind, ct)
	if hdr.Size > 0 && hdr.Size > max {
		writeErr(w, 400, "file too large")
		return
	}
	if c.EnterpriseID == "" {
		writeErrCode(w, 403, "no_enterprise", "enterprise required")
		return
	}
	scope := c.EnterpriseID
	key := filepath.ToSlash(filepath.Join(scope, kind, uuid.NewString()+extFor(ct, hdr.Filename)))

	// Buffer through a temp file so we know the exact size for S3 PutObject and
	// can hash without holding the full body in memory twice.
	tmp, err := os.CreateTemp("", "qchat-upload-*")
	if err != nil {
		writeErr(w, 500, "store failed")
		return
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, hash), io.LimitReader(file, max+1))
	if err != nil || written > max {
		writeErr(w, 400, "read failed or too large")
		return
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		writeErr(w, 500, "store failed")
		return
	}
	if err := s.blobStore().Put(r.Context(), key, tmp, written, ct); err != nil {
		writeErr(w, 500, "store failed")
		return
	}
	id := uuid.New()
	// scanned defaults to FALSE (see migration 001): no malware scanner runs yet,
	// so uploads must not claim to have been scanned. A future scan pipeline
	// flips this flag once it actually inspects the object.
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO media_objects(id, enterprise_id, uploader_id, kind, content_type, size_bytes, storage_key, checksum)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, c.EnterpriseID, c.UserID, kind, ct, written, key, hex.EncodeToString(hash.Sum(nil)))
	if err != nil {
		_ = s.blobStore().Delete(r.Context(), key)
		writeErr(w, 500, "db failed")
		return
	}
	url := "/v1/media/files/" + key
	writeJSON(w, 201, map[string]any{
		"id": id.String(), "url": url, "content_type": ct, "size": written, "kind": kind,
		"storage": s.blobStore().Name(),
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
	if !s.canAccessMediaObject(r.Context(), c.UserID, c.EnterpriseID, rel) {
		writeErr(w, 403, "forbidden")
		return
	}
	rc, contentType, size, err := s.blobStore().Open(r.Context(), rel)
	if err != nil {
		writeErr(w, 404, "file not found")
		return
	}
	defer rc.Close()
	if contentType == "" {
		contentType = contentTypeFromExt(filepath.Ext(rel))
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	// Force download when clients request Save (web/desktop/mobile).
	if r.URL.Query().Get("download") == "1" {
		name := filepath.Base(rel)
		if name == "" || name == "." || name == "/" {
			name = "download"
		}
		w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	}
	// Prefer ServeContent when the body is seekable so phones can Range-probe media.
	// Do not pre-set Content-Length — ServeContent owns Length/Range/206.
	if rs, ok := rc.(io.ReadSeeker); ok {
		http.ServeContent(w, r, filepath.Base(rel), time.Time{}, rs)
		return
	}
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}

// canAccessMediaObject allows same-enterprise peers, or any conversation member
// who already received the object in a message (so DM receivers can view/save media).
func (s *Server) canAccessMediaObject(ctx context.Context, userID, enterpriseID, rel string) bool {
	if rel == "" {
		return false
	}
	if enterpriseID != "" && strings.HasPrefix(rel, enterpriseID+"/") {
		return true
	}
	mediaPath := "/v1/media/files/" + rel
	var ok bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM messages m
			JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
			WHERE cm.user_id = $1::uuid
			  AND m.media_url <> ''
			  AND (
			    split_part(m.media_url, '?', 1) = $2
			    OR split_part(m.media_url, '?', 1) LIKE '%/' || $3
			  )
		)`, userID, mediaPath, rel).Scan(&ok)
	return err == nil && ok
}

func contentTypeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".wav":
		return "audio/wav"
	case ".webm":
		return "audio/webm"
	case ".ogg":
		return "audio/ogg"
	case ".m4a", ".mp4":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".aac":
		return "audio/aac"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
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
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return ".wav"
	case "audio/webm":
		return ".webm"
	case "audio/ogg":
		return ".ogg"
	case "audio/mp4", "audio/aac", "audio/x-m4a":
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
	// post search scoped to membership; optional in-channel filter.
	var messages []map[string]any
	if convID != "" {
		mrows, _ := s.db.Query(r.Context(), `
			SELECT m.id::text, m.conversation_id::text, m.body, m.created_at
			FROM messages m
			JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
			WHERE m.enterprise_id=$2 AND m.conversation_id=$3 AND m.recalled=FALSE
			  AND m.body ILIKE $4 AND m.created_at >= cm.history_visible_from
			  AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
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
			  AND (m.type <> 'system' OR cm.role IN ('owner','admin'))
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
