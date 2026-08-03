package server

import "strings"

// entArg maps a JWT enterprise id to a Postgres UUID argument.
// Callers must already require a non-empty enterprise (enterprise-only product).
func entArg(enterpriseID string) any {
	return strings.TrimSpace(enterpriseID)
}
