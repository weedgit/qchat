package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/auth"
	"github.com/qchat/qchat/services/api/internal/sms"
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
	writeJSON(w, 200, map[string]any{
		"captcha_id": id.String(),
		"challenge":  code, // MVP: return plaintext; production would return image bytes
		"hint":       "Enter the code shown (case-insensitive)",
	})
}

type registerReq struct {
	Phone          string `json:"phone"`
	Password       string `json:"password"`
	Username       string `json:"username"`
	InviteCode     string `json:"invite_code"`
	CaptchaID      string `json:"captcha_id"`
	Captcha        string `json:"captcha"`
	SMSChallengeID string `json:"sms_challenge_id"`
	SMSCode        string `json:"sms_code"`
	DeviceType     string `json:"device_type"`
	DeviceName     string `json:"device_name"`
}

// handleRegisterOTP sends an SMS code required before registration (JD phone verification).
func (s *Server) handleRegisterOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone      string `json:"phone"`
		InviteCode string `json:"invite_code"`
		CaptchaID  string `json:"captcha_id"`
		Captcha    string `json:"captcha"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !auth.ValidatePhone(req.Phone) {
		writeErr(w, 400, "phone must be 11 digits")
		return
	}
	if !s.consumeCaptcha(r, req.CaptchaID, req.Captcha) {
		writeErr(w, 400, "invalid captcha")
		return
	}
	var entID string
	var active bool
	err := s.db.QueryRow(r.Context(), `SELECT id::text, invite_active FROM enterprises WHERE invite_code=$1`, req.InviteCode).Scan(&entID, &active)
	if err != nil || !active {
		writeErr(w, 400, "invalid invite code")
		return
	}
	var exists bool
	_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE enterprise_id=$1 AND phone=$2)`, entID, req.Phone).Scan(&exists)
	if exists {
		writeErrFields(w, 409, "conflict", "phone already registered", map[string]string{"phone": "already registered"})
		return
	}
	code := auth.NewCaptchaCode()
	id := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO register_otp_challenges(id, phone, invite_code, code_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5)`,
		id, req.Phone, req.InviteCode, auth.HashRefresh(strings.ToUpper(code)), time.Now().Add(10*time.Minute))
	if err != nil {
		writeErr(w, 500, "challenge failed")
		return
	}
	body := sms.FormatPhoneCode(code)
	_ = s.sms.Send(r.Context(), req.Phone, body)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO sms_outbox(phone, body, provider) VALUES ($1,$2,'dev')`, req.Phone, body)
	resp := map[string]any{"challenge_id": id.String(), "expires_in": 600}
	if os.Getenv("QCHAT_SMS_PROVIDER") == "" || os.Getenv("QCHAT_SMS_PROVIDER") == "dev" {
		resp["dev_code"] = code
	}
	writeJSON(w, 200, resp)
}

func (s *Server) consumeRegisterOTP(r *http.Request, challengeID, phone, invite, code string) bool {
	if challengeID == "" || code == "" {
		return false
	}
	var phoneDB, inviteDB, hash string
	var consumed bool
	var expires time.Time
	err := s.db.QueryRow(r.Context(), `
		SELECT phone, invite_code, code_hash, consumed, expires_at
		FROM register_otp_challenges WHERE id=$1`, challengeID).
		Scan(&phoneDB, &inviteDB, &hash, &consumed, &expires)
	if err != nil || consumed || time.Now().After(expires) {
		return false
	}
	if phoneDB != phone || inviteDB != invite {
		return false
	}
	if hash != auth.HashRefresh(strings.ToUpper(code)) {
		return false
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE register_otp_challenges SET consumed=TRUE WHERE id=$1`, challengeID)
	return true
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
	if !s.consumeRegisterOTP(r, req.SMSChallengeID, req.Phone, req.InviteCode, req.SMSCode) {
		writeErr(w, 400, "invalid or missing SMS code")
		return
	}
	var entID string
	var active bool
	err := s.db.QueryRow(r.Context(), `SELECT id::text, invite_active FROM enterprises WHERE invite_code=$1`, req.InviteCode).Scan(&entID, &active)
	if err != nil || !active {
		writeErr(w, 400, "invalid invite code")
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
		VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`,
		uid, entID, req.Phone, hash, req.Username, ip, guessRegion(ip))
	if err != nil {
		var phoneTaken, userTaken bool
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE enterprise_id=$1 AND phone=$2)`, entID, req.Phone).Scan(&phoneTaken)
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE enterprise_id=$1 AND username=$2)`, entID, req.Username).Scan(&userTaken)
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
	s.audit(r.Context(), uid.String(), entID, "user.register", "user", uid.String(), "", ip, nil)
	tok, err := s.issueSession(r, uid.String(), entID, "member", req.DeviceType, req.DeviceName)
	if err != nil {
		writeErr(w, 500, "session failed")
		return
	}
	writeJSON(w, 201, tok)
}

type loginReq struct {
	Phone      string `json:"phone"`
	Password   string `json:"password"`
	InviteCode string `json:"invite_code"`
	CaptchaID  string `json:"captcha_id"`
	Captcha    string `json:"captcha"`
	DeviceType string `json:"device_type"`
	DeviceName string `json:"device_name"`
	RememberMe bool   `json:"remember_me"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !s.consumeCaptcha(r, req.CaptchaID, req.Captcha) {
		writeErr(w, 400, "invalid captcha")
		return
	}
	var uid, entID, hash, role string
	var banned bool
	err := s.db.QueryRow(r.Context(), `
		SELECT u.id::text, u.enterprise_id::text, u.password_hash, u.role, u.banned
		FROM users u JOIN enterprises e ON e.id=u.enterprise_id
		WHERE u.phone=$1 AND e.invite_code=$2`, req.Phone, req.InviteCode).
		Scan(&uid, &entID, &hash, &role, &banned)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		writeErr(w, 401, "invalid credentials")
		return
	}
	if banned {
		writeErr(w, 403, "account banned")
		return
	}
	dtype := normalizeDevice(req.DeviceType)
	// Same-type device replacement
	_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE user_id=$1 AND device_type=$2 AND revoked=FALSE`, uid, dtype)
	tok, err := s.issueSession(r, uid, entID, role, dtype, req.DeviceName)
	if err != nil {
		writeErr(w, 500, "session failed")
		return
	}
	if !req.RememberMe {
		tok["refresh_token"] = ""
	}
	s.audit(r.Context(), uid, entID, "user.login", "user", uid, "", clientIP(r), map[string]any{"device": dtype})
	writeJSON(w, 200, tok)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	_, _ = s.db.Exec(r.Context(), `UPDATE sessions SET revoked=TRUE WHERE id=$1`, c.SessionID)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	row := map[string]any{}
	var id, ent, phone, username, display, realName, region, sig, avatar, vis, fp, role, status, statusText string
	var age *int
	var banned bool
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, enterprise_id::text, phone, username, display_name, real_name, age, region, signature,
		       avatar_url, profile_visibility, friend_privacy, role, banned,
		       COALESCE(status,'offline'), COALESCE(status_text,'')
		FROM users WHERE id=$1`, c.UserID).
		Scan(&id, &ent, &phone, &username, &display, &realName, &age, &region, &sig, &avatar, &vis, &fp, &role, &banned, &status, &statusText)
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	row["id"] = id
	row["enterprise_id"] = ent
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
	writeJSON(w, 200, row)
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	_, err := s.db.Exec(r.Context(), `
		UPDATE users SET
			display_name=COALESCE($2, display_name),
			real_name=COALESCE($3, real_name),
			age=COALESCE($4, age),
			region=COALESCE($5, region),
			signature=COALESCE($6, signature),
			avatar_url=COALESCE($7, avatar_url),
			profile_visibility=COALESCE($8, profile_visibility),
			friend_privacy=COALESCE($9, friend_privacy)
		WHERE id=$1`,
		c.UserID,
		strPtr(req, "display_name"),
		strPtr(req, "real_name"),
		intPtr(req, "age"),
		strPtr(req, "region"),
		strPtr(req, "signature"),
		strPtr(req, "avatar_url"),
		strPtr(req, "profile_visibility"),
		strPtr(req, "friend_privacy"),
	)
	if err != nil {
		writeErr(w, 400, "update failed")
		return
	}
	s.handleMe(w, r)
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

func (s *Server) issueSession(r *http.Request, userID, entID, role, deviceType, deviceName string) (map[string]any, error) {
	dtype := normalizeDevice(deviceType)
	raw, hash, err := auth.NewRefreshToken()
	if err != nil {
		return nil, err
	}
	sid := uuid.New()
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO sessions(id, user_id, device_type, device_name, refresh_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, sid, userID, dtype, deviceName, hash, time.Now().Add(s.cfg.RefreshTTL))
	if err != nil {
		return nil, err
	}
	access, err := auth.IssueAccess(s.cfg.JWTSecret, s.cfg.AccessTTL, userID, entID, role, sid.String(), dtype)
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
	}, nil
}

func normalizeDevice(d string) string {
	if strings.ToLower(d) == "phone" {
		return "phone"
	}
	return "desktop"
}

func guessRegion(ip string) string {
	if strings.HasPrefix(ip, "192.168.") || ip == "127.0.0.1" || ip == "::1" {
		return "local"
	}
	return "unknown"
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
	var sid, uid, dtype, dname string
	var revoked bool
	var expires time.Time
	err := s.db.QueryRow(r.Context(), `
		SELECT id::text, user_id::text, device_type, device_name, revoked, expires_at
		FROM sessions WHERE refresh_hash=$1`, hash).
		Scan(&sid, &uid, &dtype, &dname, &revoked, &expires)
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
		SELECT enterprise_id::text, role, banned FROM users WHERE id=$1`, uid).Scan(&entID, &role, &banned)
	if err != nil || banned {
		writeErrCode(w, 403, "forbidden", "account unavailable")
		return
	}
	tok, err := s.issueSession(r, uid, entID, role, dtype, dname)
	if err != nil {
		writeErrCode(w, 500, "session_failed", "session failed")
		return
	}
	newSID, _ := tok["user_id"] // keep issueSession as-is; link rotation below via refresh lookup
	_ = newSID
	// Mark old session rotated; store replaced_by if we can find new session by refresh hash
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
	var taken bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM users WHERE enterprise_id=$1 AND username=$2 AND id<>$3
		)`, c.EnterpriseID, username, c.UserID).Scan(&taken)
	writeJSON(w, 200, map[string]any{"username": username, "available": !taken})
}

func (s *Server) handlePhoneChangeRequest(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		NewPhone string `json:"new_phone"`
	}
	if err := decodeJSON(r, &req); err != nil || !auth.ValidatePhone(req.NewPhone) {
		writeErrFields(w, 400, "invalid_phone", "phone must be 11 digits", map[string]string{"new_phone": "must be 11 digits"})
		return
	}
	var exists bool
	_ = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM users WHERE enterprise_id=$1 AND phone=$2)`, c.EnterpriseID, req.NewPhone).Scan(&exists)
	if exists {
		writeErrFields(w, 409, "phone_taken", "phone already in use", map[string]string{"new_phone": "already in use"})
		return
	}
	code := auth.NewCaptchaCode()
	id := uuid.New()
	_, err := s.db.Exec(r.Context(), `
		INSERT INTO phone_change_challenges(id, user_id, enterprise_id, new_phone, code_hash, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		id, c.UserID, c.EnterpriseID, req.NewPhone, auth.HashRefresh(strings.ToUpper(code)), time.Now().Add(10*time.Minute))
	if err != nil {
		writeErrCode(w, 500, "challenge_failed", "could not create challenge")
		return
	}
	body := "Your Qchat verification code is " + code + ". It expires in 10 minutes."
	_ = s.sms.Send(r.Context(), req.NewPhone, body)
	_, _ = s.db.Exec(r.Context(), `INSERT INTO sms_outbox(phone, body, provider) VALUES ($1,$2,'dev')`, req.NewPhone, body)
	resp := map[string]any{"challenge_id": id.String(), "expires_in": 600}
	if s.cfg.HTTPAddr != "" { // always expose in non-production via env flag
		if os.Getenv("QCHAT_SMS_PROVIDER") == "" || os.Getenv("QCHAT_SMS_PROVIDER") == "dev" {
			resp["dev_code"] = code
		}
	}
	writeJSON(w, 200, resp)
}

func (s *Server) handlePhoneChangeConfirm(w http.ResponseWriter, r *http.Request) {
	c := claimsFrom(r)
	var req struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
	}
	if err := decodeJSON(r, &req); err != nil || req.ChallengeID == "" || req.Code == "" {
		writeErrCode(w, 400, "invalid_request", "challenge_id and code required")
		return
	}
	var newPhone, codeHash string
	var used bool
	var attempts int
	var expires time.Time
	err := s.db.QueryRow(r.Context(), `
		SELECT new_phone, code_hash, used, attempts, expires_at
		FROM phone_change_challenges
		WHERE id=$1 AND user_id=$2`, req.ChallengeID, c.UserID).
		Scan(&newPhone, &codeHash, &used, &attempts, &expires)
	if err != nil || used || time.Now().After(expires) {
		writeErrCode(w, 400, "invalid_challenge", "invalid or expired challenge")
		return
	}
	if attempts >= 5 {
		writeErrCode(w, 429, "too_many_attempts", "too many attempts")
		return
	}
	if auth.HashRefresh(strings.ToUpper(req.Code)) != codeHash {
		_, _ = s.db.Exec(r.Context(), `UPDATE phone_change_challenges SET attempts=attempts+1 WHERE id=$1`, req.ChallengeID)
		writeErrCode(w, 400, "invalid_code", "invalid verification code")
		return
	}
	tag, err := s.db.Exec(r.Context(), `
		UPDATE users SET phone=$2 WHERE id=$1 AND enterprise_id=$3`, c.UserID, newPhone, c.EnterpriseID)
	if err != nil || tag.RowsAffected() == 0 {
		writeErrCode(w, 409, "phone_taken", "phone already in use")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE phone_change_challenges SET used=TRUE WHERE id=$1`, req.ChallengeID)
	s.audit(r.Context(), c.UserID, c.EnterpriseID, "user.phone_change", "user", c.UserID, "", clientIP(r), map[string]any{"new_phone": newPhone})
	writeJSON(w, 200, map[string]any{"ok": true, "phone": newPhone})
}
