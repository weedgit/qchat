package sms

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/qchat/qchat/services/api/internal/config"
)

type aliyunSender struct {
	accessKeyID     string
	accessKeySecret string
	signName        string
	templateCode    string
	regionID        string
	client          *http.Client
}

func newAliyun(cfg config.Config) (*aliyunSender, error) {
	id := strings.TrimSpace(cfg.AliyunAccessKeyID)
	secret := strings.TrimSpace(cfg.AliyunAccessKeySecret)
	sign := strings.TrimSpace(cfg.AliyunSignName)
	tpl := strings.TrimSpace(cfg.AliyunTemplateCode)
	if id == "" || secret == "" || sign == "" || tpl == "" {
		return nil, fmt.Errorf("need QCHAT_SMS_ALIYUN_ACCESS_KEY_ID, QCHAT_SMS_ALIYUN_ACCESS_KEY_SECRET, QCHAT_SMS_ALIYUN_SIGN_NAME, QCHAT_SMS_ALIYUN_TEMPLATE_CODE")
	}
	region := strings.TrimSpace(cfg.AliyunRegionID)
	if region == "" {
		region = "cn-hangzhou"
	}
	return &aliyunSender{
		accessKeyID:     id,
		accessKeySecret: secret,
		signName:        sign,
		templateCode:    tpl,
		regionID:        region,
		client:          &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (a *aliyunSender) SendOTP(ctx context.Context, phone, code string) error {
	to := NormalizeCNMobile(phone)
	if to == "" {
		// International numbers on Aliyun: pass digits with country code (no +).
		to = DigitsOnly(phone)
	}
	if to == "" {
		return fmt.Errorf("aliyun: empty phone")
	}
	paramJSON, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return err
	}

	params := map[string]string{
		"AccessKeyId":      a.accessKeyID,
		"Action":           "SendSms",
		"Format":           "JSON",
		"PhoneNumbers":     to,
		"RegionId":         a.regionID,
		"SignName":         a.signName,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   uuid.NewString(),
		"SignatureVersion": "1.0",
		"TemplateCode":     a.templateCode,
		"TemplateParam":    string(paramJSON),
		"Timestamp":        time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"Version":          "2017-05-25",
	}
	params["Signature"] = aliyunSign("POST", params, a.accessKeySecret)

	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://dysmsapi.aliyuncs.com/",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	var parsed struct {
		Code    string `json:"Code"`
		Message string `json:"Message"`
	}
	_ = json.Unmarshal(body, &parsed)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("aliyun HTTP %d: %s", res.StatusCode, strings.TrimSpace(string(body)))
	}
	if parsed.Code != "" && !strings.EqualFold(parsed.Code, "OK") {
		return fmt.Errorf("aliyun %s: %s", parsed.Code, parsed.Message)
	}
	return nil
}

func aliyunSign(method string, params map[string]string, accessKeySecret string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "Signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var canonical strings.Builder
	for i, k := range keys {
		if i > 0 {
			canonical.WriteByte('&')
		}
		canonical.WriteString(aliyunPercentEncode(k))
		canonical.WriteByte('=')
		canonical.WriteString(aliyunPercentEncode(params[k]))
	}
	stringToSign := method + "&" + aliyunPercentEncode("/") + "&" + aliyunPercentEncode(canonical.String())
	mac := hmac.New(sha1.New, []byte(accessKeySecret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func aliyunPercentEncode(s string) string {
	// Aliyun uses a slightly stricter encoding than url.QueryEscape.
	encoded := url.QueryEscape(s)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}
