package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/config"
	"github.com/qchat/qchat/services/api/internal/sms"
	"github.com/qchat/qchat/services/api/internal/ws"
)

type Server struct {
	cfg config.Config
	db  *pgxpool.Pool
	hub *ws.Hub
	sms sms.Sender
	mux *http.ServeMux
}

func New(cfg config.Config, db *pgxpool.Pool, hub *ws.Hub) *Server {
	s := &Server{cfg: cfg, db: db, hub: hub, sms: sms.NewFromEnv(), mux: http.NewServeMux()}
	s.registerWSGauge()
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.withCORS(s.withMetrics(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "qchat-api"})
	})
	// Mattermost MetricsSettings: scrape /metrics (keep off public nginx — see nginx-qchat.conf).
	s.mux.HandleFunc("GET /metrics", s.handleMetrics)

	// Auth
	s.mux.HandleFunc("GET /v1/auth/captcha", s.handleCaptcha)
	s.mux.HandleFunc("POST /v1/auth/register/otp", s.handleRegisterOTP)
	s.mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	s.mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /v1/auth/refresh", s.handleRefresh)
	s.mux.HandleFunc("POST /v1/auth/logout", s.auth(s.handleLogout))
	s.mux.HandleFunc("GET /v1/me/sessions", s.auth(s.handleListSessions))
	s.mux.HandleFunc("DELETE /v1/me/sessions/{id}", s.auth(s.handleRevokeSession))
	s.mux.HandleFunc("GET /v1/me", s.auth(s.handleMe))
	s.mux.HandleFunc("PATCH /v1/me", s.auth(s.handleUpdateMe))
	s.mux.HandleFunc("PUT /v1/me/status", s.auth(s.handleUpdateStatus))
	s.mux.HandleFunc("GET /v1/me/notify_props", s.auth(s.handleNotifyPrefs))
	s.mux.HandleFunc("PUT /v1/me/notify_props", s.auth(s.handleNotifyPrefs))
	s.mux.HandleFunc("GET /v1/usernames/available", s.auth(s.handleUsernameAvailable))
	s.mux.HandleFunc("POST /v1/me/phone/request", s.auth(s.handlePhoneChangeRequest))
	s.mux.HandleFunc("POST /v1/me/phone/confirm", s.auth(s.handlePhoneChangeConfirm))
	s.mux.HandleFunc("POST /v1/enterprises/join", s.auth(s.handleJoinEnterprise))

	// Friends
	s.mux.HandleFunc("GET /v1/friends", s.auth(s.handleListFriends))
	s.mux.HandleFunc("GET /v1/users/lookup", s.auth(s.handleUserLookup))
	s.mux.HandleFunc("GET /v1/users/{id}", s.auth(s.handleGetUser))
	s.mux.HandleFunc("POST /v1/friends/request", s.auth(s.handleFriendRequest))
	s.mux.HandleFunc("POST /v1/friends/{id}/accept", s.auth(s.handleFriendAccept))
	s.mux.HandleFunc("POST /v1/friends/{id}/reject", s.auth(s.handleFriendReject))
	s.mux.HandleFunc("POST /v1/friends/{id}/block", s.auth(s.handleFriendBlock))
	s.mux.HandleFunc("POST /v1/friends/{id}/unblock", s.auth(s.handleFriendUnblock))
	s.mux.HandleFunc("PATCH /v1/friends/{id}", s.auth(s.handleFriendNote))
	s.mux.HandleFunc("GET /v1/media/files/{path...}", s.handleMediaGet)

	// Conversations / messages
	s.mux.HandleFunc("GET /v1/conversations", s.auth(s.handleListConversations))
	s.mux.HandleFunc("POST /v1/conversations/dm", s.auth(s.handleOpenDM))
	s.mux.HandleFunc("PATCH /v1/conversations/{id}/prefs", s.auth(s.handleConversationPrefs))
	s.mux.HandleFunc("POST /v1/conversations/{id}/unread", s.auth(s.handleMarkUnread))
	s.mux.HandleFunc("GET /v1/groups/{id}", s.auth(s.handleGroupDetails))
	s.mux.HandleFunc("PATCH /v1/groups/{id}", s.auth(s.handlePatchGroup))
	s.mux.HandleFunc("GET /v1/groups/{id}/pending", s.auth(s.handleGroupPending))
	s.mux.HandleFunc("POST /v1/groups", s.auth(s.handleCreateGroup))
	s.mux.HandleFunc("POST /v1/groups/join", s.auth(s.handleJoinGroup))
	s.mux.HandleFunc("POST /v1/groups/{id}/approve", s.auth(s.handleApproveJoin))
	s.mux.HandleFunc("POST /v1/groups/{id}/members", s.auth(s.handleAddGroupMembers))
	s.mux.HandleFunc("POST /v1/groups/{id}/mute", s.auth(s.handleMuteMember))
	s.mux.HandleFunc("POST /v1/groups/{id}/admins", s.auth(s.handleAppointAdmin))
	s.mux.HandleFunc("GET /v1/conversations/{id}/messages", s.auth(s.handleListMessages))
	s.mux.HandleFunc("POST /v1/conversations/{id}/messages", s.auth(s.handleSendMessage))
	s.mux.HandleFunc("POST /v1/messages/{id}/recall", s.auth(s.handleRecall))
	s.mux.HandleFunc("POST /v1/messages/{id}/read", s.auth(s.handleRead))
	s.mux.HandleFunc("POST /v1/messages/{id}/delivered", s.auth(s.handleDelivered))
	s.mux.HandleFunc("POST /v1/messages/{id}/forward", s.auth(s.handleForward))
	s.mux.HandleFunc("POST /v1/messages/{id}/react", s.auth(s.handleReact))
	s.mux.HandleFunc("PATCH /v1/messages/{id}", s.auth(s.handleEditMessage))
	s.mux.HandleFunc("POST /v1/messages/{id}/pin", s.auth(s.handlePinMessage))
	s.mux.HandleFunc("POST /v1/messages/{id}/unpin", s.auth(s.handleUnpinMessage))

	// Media
	s.mux.HandleFunc("POST /v1/media/upload", s.auth(s.handleMediaUpload))

	// Collaboration
	s.mux.HandleFunc("POST /v1/spaces", s.auth(s.handleCreateSpace))
	s.mux.HandleFunc("POST /v1/channels", s.auth(s.handleCreateChannel))
	s.mux.HandleFunc("GET /v1/search", s.auth(s.handleSearch))
	s.mux.HandleFunc("POST /v1/webhooks", s.auth(s.handleCreateWebhook))
	s.mux.HandleFunc("POST /v1/bots", s.auth(s.handleCreateBot))

	// Admin
	s.mux.HandleFunc("GET /v1/admin/enterprises", s.auth(s.handleAdminEnterprises))
	s.mux.HandleFunc("POST /v1/admin/enterprises", s.auth(s.handleAdminCreateEnterprise))
	s.mux.HandleFunc("GET /v1/admin/users", s.auth(s.handleAdminUsers))
	s.mux.HandleFunc("POST /v1/admin/users", s.auth(s.handleAdminCreateUser))
	s.mux.HandleFunc("POST /v1/admin/users/{id}/ban", s.auth(s.handleAdminBan))
	s.mux.HandleFunc("POST /v1/admin/users/{id}/reset-password", s.auth(s.handleAdminResetPassword))
	s.mux.HandleFunc("GET /v1/admin/messages", s.auth(s.handleAdminMessages))
	s.mux.HandleFunc("GET /v1/admin/audits", s.auth(s.handleAdminAudits))
	s.mux.HandleFunc("POST /v1/admin/invite/rotate", s.auth(s.handleAdminRotateInvite))
	s.mux.HandleFunc("POST /v1/admin/invite/revoke", s.auth(s.handleAdminRevokeInvite))
	s.mux.HandleFunc("POST /v1/admin/invite/activate", s.auth(s.handleAdminActivateInvite))
	s.mux.HandleFunc("PATCH /v1/admin/enterprises/{id}", s.auth(s.handleAdminPatchEnterprise))
	s.mux.HandleFunc("POST /v1/admin/retention/run", s.auth(s.handleAdminRunRetention))

	// Calls (LiveKit 1:1) + push stubs
	s.mux.HandleFunc("POST /v1/calls", s.auth(s.handleStartCall))
	s.mux.HandleFunc("POST /v1/calls/{id}/answer", s.auth(s.handleAnswerCall))
	s.mux.HandleFunc("POST /v1/calls/{id}/decline", s.auth(s.handleDeclineCall))
	s.mux.HandleFunc("POST /v1/calls/{id}/hangup", s.auth(s.handleHangupCall))
	s.mux.HandleFunc("POST /v1/push/register", s.auth(s.handlePushRegister))
	s.mux.HandleFunc("POST /v1/push/unregister", s.auth(s.handlePushUnregister))
	s.mux.HandleFunc("GET /v1/push/devices", s.auth(s.handlePushDevices))
	s.mux.HandleFunc("DELETE /v1/push/devices/{id}", s.auth(s.handlePushDeviceDelete))
	s.mux.HandleFunc("GET /v1/push/vapid", s.handlePushVAPID)

	// WebSocket
	s.mux.HandleFunc("GET /v1/ws", s.handleWS)
}

type ctxKey string

const claimsKey ctxKey = "claims"

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing token")
			return
		}
		claims, err := auth.ParseAccess(s.cfg.JWTSecret, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid token")
			return
		}
		if sessionAccessRevoked(claims.SessionID) {
			writeErr(w, http.StatusUnauthorized, "session revoked")
			return
		}
		s.touchSession(claims.SessionID)
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next(w, r.WithContext(ctx))
	}
}

func claimsFrom(r *http.Request) *auth.Claims {
	c, _ := r.Context().Value(claimsKey).(*auth.Claims)
	return c
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := corsAllowOrigin(s.cfg.CORSOrigin, r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if origin != "*" {
				w.Header().Set("Vary", "Origin")
			}
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// corsAllowOrigin picks ACAO. QCHAT_CORS_ORIGIN may be "*", one origin, or a comma list.
func corsAllowOrigin(cfg, reqOrigin string) string {
	cfg = strings.TrimSpace(cfg)
	reqOrigin = strings.TrimSpace(reqOrigin)
	if cfg == "*" || cfg == "" {
		if reqOrigin != "" {
			return reqOrigin
		}
		return "*"
	}
	if strings.HasPrefix(reqOrigin, "http://localhost:") || strings.HasPrefix(reqOrigin, "http://127.0.0.1:") {
		return reqOrigin
	}
	for _, part := range strings.Split(cfg, ",") {
		part = strings.TrimSpace(part)
		if part != "" && part == reqOrigin {
			return reqOrigin
		}
	}
	if reqOrigin == "" {
		for _, part := range strings.Split(cfg, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				return part
			}
		}
	}
	return ""
}

// isDevBrowserOrigin allows http(s) origins on loopback or RFC1918 hosts so
// opening the web app via a VM LAN IP (e.g. http://192.168.x.x:3000) works.
func isDevBrowserOrigin(o string) bool {
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeErrCode(w, code, "error", msg)
}

func writeErrCode(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"code": code, "message": msg, "error": msg})
}

func writeErrFields(w http.ResponseWriter, status int, code, msg string, fields map[string]string) {
	writeJSON(w, status, map[string]any{"code": code, "message": msg, "error": msg, "fields": fields})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func clientIP(r *http.Request) string {
	if x := r.Header.Get("X-Real-IP"); x != "" {
		return strings.TrimSpace(x)
	}
	if x := r.Header.Get("X-Forwarded-For"); x != "" {
		return strings.TrimSpace(strings.Split(x, ",")[0])
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i]
	}
	return host
}

func (s *Server) audit(ctx context.Context, actorID, enterpriseID, action, targetType, targetID, reason, ip string, meta any) {
	b, _ := json.Marshal(meta)
	_, _ = s.db.Exec(ctx, `
		INSERT INTO audit_logs(actor_id, enterprise_id, action, target_type, target_id, reason, ip, meta)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7, $8::jsonb)`,
		actorID, enterpriseID, action, targetType, targetID, reason, ip, string(b))
}

func now() time.Time { return time.Now().UTC() }
