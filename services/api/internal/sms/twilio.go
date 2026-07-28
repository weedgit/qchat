package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/qchat/qchat/services/api/internal/config"
)

type twilioSender struct {
	accountSID string
	authToken  string
	from       string
	client     *http.Client
}

func newTwilio(cfg config.Config) (*twilioSender, error) {
	sid := strings.TrimSpace(cfg.TwilioAccountSID)
	token := strings.TrimSpace(cfg.TwilioAuthToken)
	from := strings.TrimSpace(cfg.TwilioFrom)
	if sid == "" || token == "" || from == "" {
		return nil, fmt.Errorf("need QCHAT_SMS_TWILIO_ACCOUNT_SID, QCHAT_SMS_TWILIO_AUTH_TOKEN, QCHAT_SMS_TWILIO_FROM")
	}
	return &twilioSender{
		accountSID: sid,
		authToken:  token,
		from:       from,
		client:     &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (t *twilioSender) SendOTP(ctx context.Context, phone, code string) error {
	to := ToE164(phone)
	form := url.Values{}
	form.Set("To", to)
	form.Set("From", t.from)
	form.Set("Body", FormatPhoneCode(code))

	endpoint := fmt.Sprintf(
		"https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json",
		url.PathEscape(t.accountSID),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(t.accountSID, t.authToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := t.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("twilio HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err == nil {
		if status, _ := parsed["status"].(string); status == "failed" || status == "undelivered" {
			return fmt.Errorf("twilio message status %q", status)
		}
	}
	return nil
}
