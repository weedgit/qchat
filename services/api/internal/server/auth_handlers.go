package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
)

func (s *Server) handleCaptcha(w http.ResponseWriter, r *http.Request) {
	code := auth.NewCaptchaCode()
	id := uuid.New()
	_, err := s.db.Exec(r.Context(), `INSERT INTO captchas(id, answer, expires_at) VALUES ($1,$2,$3)`,
		id, strings.ToUpper(code), time.Now().Add(5*time.Minute))
	if err != nil {
		writeErr(w, 500, "captcha failed")
		return
	}
	imageURL, err := auth.RenderCaptchaPNG(code)
	if err != nil {
		writeErr(w, 500, "captcha image failed")
		return
	}
	resp := map[string]any{
		"captcha_id": id.String(),
		"image":      imageURL, // data:image/png;base64,… — answer never returned in prod
		"hint":       "Enter the characters shown (case-insensitive)",
	}
	// Non-production only: let automated tests / local tooling solve captcha.
	if s.cfg.Env != "production" {
		resp["dev_answer"] = code
	}
	writeJSON(w, 200, resp)
}

type registerReq struct {
	Phone      string `json:"phone"`
	Password   string `json:"password"`
	Username   string `json:"username"`
	InviteCode string `json:"invite_code"`
	CaptchaID  string `json:"captcha_id"`
	Captcha    string `json:"captcha"`
	DeviceType string `json:"device_type"`
	DeviceName string `json:"device_name"`
	DeviceID   string `json:"device_id"`
	Platform   string `json:"platform"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !auth.ValidatePhone(req.Phone) {
		writeErr(w, 400, "phone must be 11 digits")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !auth.ValidateUsername(req.Username) {
		writeErr(w, 400, "invalid username")
		return
	}
	if !s.consumeCaptcha(r, req.CaptchaID, req.Captcha) {
		writeErr(w, 400, "invalid captcha")
		return
	}
	invite := strings.ToUpper(strings.TrimSpace(req.InviteCode))
	if invite == "" {
		writeErrCode(w, 400, "invite_required", "invite code required")
		return
	}
	var entID, entName string
	var active bool
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, invite_active, name FROM enterprises WHERE invite_code=$1`, invite).
		Scan(&entID, &active, &entName)
	if err != nil || !active {
		writeErrCode(w, 400, "invalid_invite", "invalid invite code")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, 500, "hash failed")
		return
	}
	uid := uuid.New()
	ip := clientIP(r)
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO users(id, enterprise_id, phone, password_hash, username, display_name, register_ip, register_region)
		VALUES ($1,$2::uuid,$3,$4,$5,$5,$6,$7)`,
		uid, entID, req.Phone, hash, req.Username, ip, guessRegion(ip))
	if err != nil {
		var phoneTaken, userTaken bool
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)`, req.Phone).Scan(&phoneTaken)
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE lower(username)=lower($1))`, req.Username).Scan(&userTaken)
		fields := map[string]string{}
		if phoneTaken {
			fields["phone"] = "already registered"
		}
		if userTaken {
			fields["username"] = "already taken"
		}
		writeErrFields(w, 409, "conflict", "phone or username already exists", fields)
		return
	}
	s.audit(r.Context(), uid.String(), entID, "enterprise.join", "enterprise", entID, "", ip, map[string]any{
		"invite_code": invite, "at": "register",
	})
	s.audit(r.Context(), uid.String(), entID, "user.register", "user", uid.String(), "", ip, nil)
	deviceID := ensureDeviceID(req.DeviceID)
	dtype := normalizeDevice(req.DeviceType)
	s.revokeSameTypeSessions(r, uid.String(), dtype)
	tok, err := s.issueSession(r, uid.String(), entID, "member", dtype, req.DeviceName, deviceID, req.Platform)
	if err != nil {
		writeErr(w, 500, "session failed")
		return
	}
	tok["enterprise_id"] = entID
	tok["name"] = entName
	writeJSON(w, 201, tok)
}

type loginReq struct {
	Phone      string `json:"phone"`
	Password   string `json:"password"`
	CaptchaID  string `json:"captcha_id"`
	Captcha    string `json:"captcha"`
	DeviceType string `json:"device_type"`
	DeviceName string `json:"device_name"`
	DeviceID   string `json:"device_id"`
	Platform   string `json:"platform"`
	RememberMe bool   `json:"remember_me"`
	MFACode    string `json:"mfa_code"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	ip := clientIP(r)
	if s.rateLimitEnabled() && s.loginGuard.locked(req.Phone, ip) {
		w.Header().Set("Retry-After", "900")
		writeErrCode(w, 429, "login_locked", "too many failed login attempts; try again later")
		return
	}
	if !s.consumeCaptcha(r, req.CaptchaID, req.Captcha) {
		writeErr(w, 400, "invalid captcha")
		return
	}
	var uid, hash, role, mfaSecret string
	var banned, mfaActive bool
	var entNull *string
	err := s.db.QueryRow(r.Context(), `
		SELECT u.id::text, u.enterprise_id::text, u.password_hash, u.role, u.banned,
		       COALESCE(u.mfa_secret,''), u.mfa_active
		FROM users u
		WHERE u.phone=$1`, req.Phone).
		Scan(&uid, &entNull, &hash, &role, &banned, &mfaSecret, &mfaActive)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		if s.rateLimitEnabled() {
			s.loginGuard.fail(req.Phone, ip)
		}
		writeErr(w, 401, "invalid credentials")
		return
	}
	entID := ""
	if entNull != nil {
		entID = *entNull
	}
	if entID == "" {
		writeErrCode(w, 403, "no_enterprise", "enterprise required")
		return
	}
	if banned {
		writeErr(w, 403, "account banned")
		return
	}
	if !s.verifyLoginIPAllowlist(w, r, uid, entID, role) {
		return
	}
	if !s.verifyLoginMFA(w, r, uid, role, mfaSecret, mfaActive, req.MFACode) {
		return
	}
	dtype := normalizeDevice(req.DeviceType)
	deviceID := ensureDeviceID(req.DeviceID)
	s.loginGuard.clear(req.Phone, ip)
	s.recordAdminLoginAlerts(r.Context(), uid, entID, role, ip, deviceID, dtype, req.Platform)
	// One session per surface: web, desktop, phone (new login replaces same type).
	s.revokeSameTypeSessions(r, uid, dtype)
	tok, err := s.issueSession(r, uid, entID, role, dtype, req.DeviceName, deviceID, req.Platform)
	if err != nil {
		writeErr(w, 500, "session failed")
		return
	}
	if !req.RememberMe {
		tok["refresh_token"] = ""
	}
	s.audit(r.Context(), uid, entID, "user.login", "user", uid, "", ip, map[string]any{
		"device": dtype, "device_id": deviceID,
	})
	writeJSON(w, 200, tok)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE id=$1`, c.SessionID)
	s.kickRevokedSessions([]string{c.SessionID}, "logout")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleListSessions lists active login sessions with platform + IP location.
func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, device_type, COALESCE(device_name,''), COALESCE(device_id,''),
		       COALESCE(platform,''), COALESCE(ip,''), COALESCE(ip_region,''),
		       COALESCE(user_agent,''),
		       created_at, expires_at, COALESCE(last_active_at, created_at)
		FROM sessions
		WHERE user_id=$1 AND revoked=FALSE AND expires_at>now()
		ORDER BY COALESCE(last_active_at, created_at) DESC`, c.UserID)
	if err != nil {
		writeErr(w, 500, "list failed")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, dtype, dname, did, platform, ip, region, ua string
		var created, expires, lastActive time.Time
		if rows.Scan(&id, &dtype, &dname, &did, &platform, &ip, &region, &ua, &created, &expires, &lastActive) != nil {
			continue
		}
		platform = displayPlatform(platform, dname, dtype, ua)
		out = append(out, map[string]any{
			"id": id, "device_type": dtype, "device_name": dname, "device_id": did,
			"platform": platform, "ip": ip, "ip_region": region,
			"location":       formatSessionLocation(ip, region),
			"estimated":      region != "" && region != "Local network" && region != "Unknown location",
			"current":        id == c.SessionID,
			"created_at":     created.UTC(),
			"expires_at":     expires.UTC(),
			"last_active_at": lastActive.UTC(),
		})
	}
	writeJSON(w, 200, out)
}

// handleRevokeSession revokes another (or current) session by id for this user.
func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	sid := r.PathValue("id")
	tag, err := s.db.Exec(r.Context(), `
		UPDATE sessions SET revoked=TRUE
		WHERE id=$1 AND user_id=$2 AND revoked=FALSE`, sid, c.UserID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "session not found")
		return
	}
	s.kickRevokedSessions([]string{sid}, "revoked")
	writeJSON(w, 200, map[string]any{"ok": true, "id": sid})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	row := map[string]any{}
	var id, ent, entName, phone, username, display, realName, region, sig, avatar, vis, fp, role, status, statusText string
	var age *int
	var banned, mfaActive bool
	err := s.db.QueryRow(r.Context(), `
		SELECT u.id::text, COALESCE(u.enterprise_id::text, ''), COALESCE(e.name, ''),
		       u.phone, u.username, u.display_name, u.real_name, u.age, u.region, u.signature,
		       u.avatar_url, u.profile_visibility, u.friend_privacy, u.role, u.banned,
		       COALESCE(u.status,'offline'), COALESCE(u.status_text,''), u.mfa_active
		FROM users u
		LEFT JOIN enterprises e ON e.id = u.enterprise_id
		WHERE u.id=$1`, c.UserID).
		Scan(&id, &ent, &entName, &phone, &username, &display, &realName, &age, &region, &sig, &avatar, &vis, &fp, &role, &banned, &status, &statusText, &mfaActive)
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	row["id"] = id
	row["enterprise_id"] = ent
	row["enterprise_name"] = entName
	row["phone"] = phone
	row["username"] = username
	row["display_name"] = display
	row["real_name"] = realName
	row["age"] = age
	row["region"] = region
	row["signature"] = sig
	row["avatar_url"] = avatar
	row["profile_visibility"] = vis
	row["friend_privacy"] = fp
	row["role"] = role
	row["banned"] = banned
	row["status"] = status
	row["status_text"] = statusText
	row["mfa_active"] = mfaActive
	writeJSON(w, 200, row)
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	vis := strPtr(req, "profile_visibility")
	if vis != nil {
		switch *vis {
		case "public", "friends":
		default:
			writeErr(w, 400, "invalid profile_visibility")
			return
		}
	}
	fp := strPtr(req, "friend_privacy")
	if fp != nil {
		switch *fp {
		case "open", "approval", "closed":
		default:
			writeErr(w, 400, "invalid friend_privacy")
			return
		}
	}
	display := strPtr(req, "display_name")
	if display != nil {
		trimmed := strings.TrimSpace(*display)
		if err := auth.ValidateDisplayName(trimmed); err != nil {
			writeErrFields(w, 400, "invalid_display_name", err.Error(), map[string]string{"display_name": err.Error()})
			return
		}
		taken, err := s.displayNameTaken(r, trimmed, c.UserID)
		if err != nil {
			writeErr(w, 500, "lookup failed")
			return
		}
		if taken {
			writeErrFields(w, 409, "conflict", "display name already taken", map[string]string{"display_name": "already taken"})
			return
		}
		display = &trimmed
	}
	username := strPtr(req, "username")
	if username != nil {
		trimmed := strings.TrimSpace(*username)
		if !auth.ValidateUsername(trimmed) {
			writeErrFields(w, 400, "invalid_username", "invalid username", map[string]string{"username": "must be 2-32 letters, digits, underscore, or emoji"})
			return
		}
		taken, err := s.usernameTaken(r, trimmed, c.UserID)
		if err != nil {
			writeErr(w, 500, "lookup failed")
			return
		}
		if taken {
			writeErrFields(w, 409, "conflict", "username already taken", map[string]string{"username": "already taken"})
			return
		}
		username = &trimmed
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE users SET
			username=COALESCE($2, username),
			display_name=COALESCE($3, display_name),
			real_name=COALESCE($4, real_name),
			age=COALESCE($5, age),
			region=COALESCE($6, region),
			signature=COALESCE($7, signature),
			avatar_url=COALESCE($8, avatar_url),
			profile_visibility=COALESCE($9, profile_visibility),
			friend_privacy=COALESCE($10, friend_privacy)
		WHERE id=$1`,
		c.UserID,
		username,
		display,
		strPtr(req, "real_name"),
		intPtr(req, "age"),
		strPtr(req, "region"),
		strPtr(req, "signature"),
		strPtr(req, "avatar_url"),
		vis,
		fp,
	)
	if err != nil {
		writeErr(w, 400, "update failed")
		return
	}
	s.handleMe(w, r)
}

func (s *Server) displayNameTaken(r *http.Request, name, exceptUserID string) (bool, error) {
	var taken bool
	err := s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM users
			WHERE lower(display_name)=lower($1) AND ($2='' OR id::text<>$2)
		)`, name, exceptUserID).Scan(&taken)
	return taken, err
}

func (s *Server) usernameTaken(r *http.Request, name, exceptUserID string) (bool, error) {
	var taken bool
	err := s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM users
			WHERE lower(username)=lower($1) AND ($2='' OR id::text<>$2)
		)`, name, exceptUserID).Scan(&taken)
	return taken, err
}

func (s *Server) consumeCaptcha(r *http.Request, id, answer string) bool {
	if id == "" || answer == "" {
		return false
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE captchas SET used=TRUE
		WHERE id=$1 AND used=FALSE AND expires_at>now() AND upper(answer)=upper($2)`, id, answer)
	if err != nil {
		return false
	}
	return tag.RowsAffected() == 1
}

func (s *Server) issueSession(r *http.Request, userID, entID, role, deviceType, deviceName, deviceID, platform string) (map[string]any, error) {
	dtype := normalizeDevice(deviceType)
	did := ensureDeviceID(deviceID)
	raw, hash, err := auth.NewRefreshToken()
	if err != nil {
		return nil, err
	}
	ip := clientIP(r)
	region := resolveSessionLocation(r, ip)
	ua := r.Header.Get("User-Agent")
	if len(ua) > 512 {
		ua = ua[:512]
	}
	plat := strings.TrimSpace(platform)
	if plat == "" {
		plat = strings.TrimSpace(deviceName)
	}
	if plat == "" {
		plat = dtype
	}
	if len(plat) > 200 {
		plat = plat[:200]
	}
	sid := uuid.New()
	now := time.Now().UTC()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO sessions(id, user_id, device_type, device_name, device_id, refresh_hash, expires_at, ip, ip_region, platform, user_agent, last_active_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		sid, userID, dtype, deviceName, did, hash, now.Add(s.cfg.RefreshTTL), ip, region, plat, ua, now)
	if err != nil {
		return nil, err
	}
	access, err := auth.IssueAccess(s.cfg.JWTSecret, s.cfg.AccessTTL, userID, entID, role, sid.String(), dtype, did)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_token":  access,
		"refresh_token": raw,
		"token_type":    "Bearer",
		"expires_in":    int(s.cfg.AccessTTL.Seconds()),
		"user_id":       userID,
		"enterprise_id": entID,
		"role":          role,
		"device_id":     did,
	}, nil
}

func normalizeDevice(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case "phone", "mobile":
		return "phone"
	case "web", "browser":
		return "web"
	case "desktop", "electron", "pc":
		return "desktop"
	default:
		// Legacy clients that omitted type: treat as web (browser).
		return "web"
	}
}

func normalizeDeviceID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) > 128 {
		return id[:128]
	}
	return id
}

func ensureDeviceID(id string) string {
	if n := normalizeDeviceID(id); n != "" {
		return n
	}
	return uuid.NewString()
}

// guessRegion stores a registration region for admin display (requirements BE#8).
// Public IPs use the same best-effort geo lookup as session locations.
func guessRegion(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "unknown"
	}
	if isPrivateOrLocalIP(ip) {
		return "local"
	}
	if loc := lookupEstimatedLocation(ip); loc != "" {
		return loc
	}
	return "unknown"
}

func formatSessionLocation(ip, region string) string {
	ip = strings.TrimSpace(ip)
	region = strings.TrimSpace(region)
	switch {
	case region != "" && region != "Unknown location" && region != "Local network":
		if ip != "" {
			return "Approx. " + region + " · " + ip
		}
		return "Approx. " + region
	case region == "Local network":
		if ip != "" {
			return "Local network · " + ip
		}
		return "Local network"
	case ip != "":
		return "Unknown location · " + ip
	default:
		return "Unknown location"
	}
}

func isPrivateOrLocalIP(ip string) bool {
	ip = strings.Trim(ip, "[]")
	if ip == "127.0.0.1" || ip == "::1" || ip == "localhost" {
		return true
	}
	if strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") {
		return true
	}
	if strings.HasPrefix(ip, "172.") {
		// 172.16.0.0 – 172.31.255.255
		parts := strings.Split(ip, ".")
		if len(parts) >= 2 {
			second, err := strconv.Atoi(parts[1])
			if err == nil && second >= 16 && second <= 31 {
				return true
			}
		}
	}
	if strings.HasPrefix(ip, "fc") || strings.HasPrefix(ip, "fd") || strings.HasPrefix(ip, "fe80:") {
		return true
	}
	return false
}

func countryLabel(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	names := map[string]string{
		"CN": "China", "US": "United States", "DE": "Germany", "GB": "United Kingdom",
		"JP": "Japan", "KR": "South Korea", "SG": "Singapore", "HK": "Hong Kong",
		"TW": "Taiwan", "AU": "Australia", "CA": "Canada", "FR": "France",
		"IN": "India", "NL": "Netherlands", "FI": "Finland",
	}
	if n, ok := names[code]; ok {
		return n
	}
	return code
}

func strPtr(m map[string]any, k string) *string {
	v, ok := m[k]
	if !ok || v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return &s
}

func boolPtr(m map[string]any, k string) *bool {
	v, ok := m[k]
	if !ok || v == nil {
		return nil
	}
	b, ok := v.(bool)
	if !ok {
		return nil
	}
	return &b
}

func intPtr(m map[string]any, k string) *int {
	v, ok := m[k]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64:
		i := int(n)
		return &i
	case int:
		return &n
	default:
		return nil
	}
}

func hashToken(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decodeJSON(r, &req); err != nil || req.RefreshToken == "" {
		writeErrCode(w, 400, "invalid_request", "refresh_token required")
		return
	}
	hash := auth.HashRefresh(req.RefreshToken)
	var sid, uid, dtype, dname, did, platform string
	var revoked bool
	var expires time.Time
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, user_id::text, device_type, device_name, COALESCE(device_id,''),
		       COALESCE(platform,''), revoked, expires_at
		FROM sessions WHERE refresh_hash=$1`, hash).
		Scan(&sid, &uid, &dtype, &dname, &did, &platform, &revoked, &expires)
	if err != nil {
		writeErrCode(w, 401, "invalid_refresh", "invalid refresh token")
		return
	}
	if revoked || time.Now().After(expires) {
		// reuse after revoke = theft signal: revoke all user sessions
		_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE user_id=$1`, uid)
		writeErrCode(w, 401, "refresh_reused", "refresh token reused or expired")
		return
	}
	var entID, role string
	var banned bool
	err = s.db.QueryRow(r.Context(), `
		SELECT COALESCE(enterprise_id::text,''), role, banned FROM users WHERE id=$1`, uid).Scan(&entID, &role, &banned)
	if err != nil || banned {
		writeErrCode(w, 403, "forbidden", "account unavailable")
		return
	}
	tok, err := s.issueSession(r, uid, entID, role, dtype, dname, did, platform)
	if err != nil {
		writeErrCode(w, 500, "session_failed", "session failed")
		return
	}
	newHash := auth.HashRefresh(tok["refresh_token"].(string))
	var newID string
	_ = s.db.QueryRow(r.Context(), `SELECT id::text FROM sessions WHERE refresh_hash=$1`, newHash).Scan(&newID)
	_, _ = s.db.Exec(r.Context(), `
		UPDATE sessions SET revoked=TRUE, rotated_at=now(), replaced_by=NULLIF($2,'')::uuid
		WHERE id=$1`, sid, newID)
	writeJSON(w, 200, tok)
}

func (s *Server) handleUsernameAvailable(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if !auth.ValidateUsername(username) {
		writeErrFields(w, 400, "invalid_username", "invalid username", map[string]string{"username": "must be 2-32 letters, digits, or underscore"})
		return
	}
	taken, err := s.usernameTaken(r, username, c.UserID)
	if err != nil {
		writeErr(w, 500, "lookup failed")
		return
	}
	writeJSON(w, 200, map[string]any{"username": username, "available": !taken})
}

func (s *Server) handleDisplayNameAvailable(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	name := strings.TrimSpace(r.URL.Query().Get("display_name"))
	if err := auth.ValidateDisplayName(name); err != nil {
		writeErrFields(w, 400, "invalid_display_name", err.Error(), map[string]string{"display_name": err.Error()})
		return
	}
	taken, err := s.displayNameTaken(r, name, c.UserID)
	if err != nil {
		writeErr(w, 500, "lookup failed")
		return
	}
	writeJSON(w, 200, map[string]any{"display_name": name, "available": !taken})
}

func (s *Server) handlePhoneChange(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		NewPhone string `json:"new_phone"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil || !auth.ValidatePhone(req.NewPhone) {
		writeErrFields(w, 400, "invalid_phone", "phone must be 11 digits", map[string]string{"new_phone": "must be 11 digits"})
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		writeErrCode(w, 400, "password_required", "password required")
		return
	}
	var hash string
	var currentPhone string
	err := s.db.QueryRow(r.Context(), `
		SELECT password_hash, phone FROM users WHERE id=$1`, c.UserID).Scan(&hash, &currentPhone)
	if err != nil {
		writeErr(w, 404, "user not found")
		return
	}
	if !auth.CheckPassword(hash, req.Password) {
		writeErrCode(w, 401, "invalid_password", "incorrect password")
		return
	}
	if req.NewPhone == currentPhone {
		writeJSON(w, 200, map[string]any{"ok": true, "phone": currentPhone})
		return
	}
	var exists bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1 AND id<>$2)`, req.NewPhone, c.UserID).Scan(&exists)
	if exists {
		writeErrFields(w, 409, "phone_taken", "phone already in use", map[string]string{"new_phone": "already in use"})
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE users SET phone=$2 WHERE id=$1`, c.UserID, req.NewPhone)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 409, "phone_taken", "phone already in use")
		return
	}
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.phone_change", "user", c.UserID, "", clientIP(r), map[string]any{"new_phone": req.NewPhone})
	writeJSON(w, 200, map[string]any{"ok": true, "phone": req.NewPhone})
}
