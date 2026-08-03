package push

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestGetuiSignShape(t *testing.T) {
	appkey := "appkey"
	ts := "1451207094490"
	master := "master"
	sum := sha256.Sum256([]byte(appkey + ts + master))
	got := hex.EncodeToString(sum[:])
	if len(got) != 64 {
		t.Fatalf("sha256 hex length: %d", len(got))
	}
}

func TestGetuiEnabled(t *testing.T) {
	off := Config{}
	if off.GetuiEnabled() {
		t.Fatal("empty config should be disabled")
	}
	on := Config{
		GetuiAppID:        "id",
		GetuiAppKey:       "key",
		GetuiMasterSecret: "secret",
	}
	if !on.GetuiEnabled() {
		t.Fatal("credentials should enable getui by default")
	}
	on.GetuiEnabledFlag = "false"
	if on.GetuiEnabled() {
		t.Fatal("explicit false should disable")
	}
}
