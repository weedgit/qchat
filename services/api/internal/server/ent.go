package server

import "strings"

// entArg maps a JWT enterprise id to a Postgres value.
// Empty string means a personal account (NULL enterprise_id).
func entArg(enterpriseID string) any {
	if strings.TrimSpace(enterpriseID) == "" {
		return nil
	}
	return enterpriseID
}
