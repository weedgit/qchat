package server

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// ensureEnterpriseDefaultChat finds or creates the company internal social_group
// for an enterprise. Returns conversation id.
func (s *Server) ensureEnterpriseDefaultChat(ctx context.Context, enterpriseID, preferredOwnerID string) (string, error) {
	var convID string
	err := s.db.QueryRow(ctx, `
		SELECT id::text FROM conversations
		WHERE enterprise_id=$1 AND is_enterprise_default=TRUE
		LIMIT 1`, enterpriseID).Scan(&convID)
	if err == nil && convID != "" {
		return convID, nil
	}

	var name string
	_ = s.db.QueryRow(ctx, `SELECT name FROM enterprises WHERE id=$1`, enterpriseID).Scan(&name)
	if name == "" {
		name = "Company"
	}

	ownerID := preferredOwnerID
	if ownerID == "" {
		_ = s.db.QueryRow(ctx, `
			SELECT id::text FROM users
			WHERE enterprise_id=$1 AND role='enterprise_admin' AND banned=FALSE
			ORDER BY created_at ASC LIMIT 1`, enterpriseID).Scan(&ownerID)
	}
	if ownerID == "" {
		_ = s.db.QueryRow(ctx, `
			SELECT id::text FROM users
			WHERE enterprise_id=$1 AND banned=FALSE
			ORDER BY created_at ASC LIMIT 1`, enterpriseID).Scan(&ownerID)
	}

	id := uuid.New()
	publicID := "C" + id.String()[:8]
	_, err = s.db.Exec(ctx, `
		INSERT INTO conversations(id, enterprise_id, type, title, description, public_id, owner_id, is_enterprise_default)
		VALUES ($1,$2,'social_group',$3,$4,$5,NULLIF($6,'')::uuid,TRUE)`,
		id, enterpriseID, name, "Company internal chat", publicID, ownerID)
	if err != nil {
		// Race: another request created it — re-select.
		err2 := s.db.QueryRow(ctx, `
			SELECT id::text FROM conversations
			WHERE enterprise_id=$1 AND is_enterprise_default=TRUE
			LIMIT 1`, enterpriseID).Scan(&convID)
		if err2 != nil {
			return "", fmt.Errorf("create default chat: %w", err)
		}
		return convID, nil
	}
	convID = id.String()

	if ownerID != "" {
		_, _ = s.db.Exec(ctx, `
			INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
			VALUES ($1,$2,'owner', TIMESTAMPTZ '1970-01-01')
			ON CONFLICT DO NOTHING`, convID, ownerID)
	}
	return convID, nil
}

// addUserToEnterpriseDefaultChat ensures the user is a member of the company chat.
func (s *Server) addUserToEnterpriseDefaultChat(ctx context.Context, enterpriseID, userID string) error {
	convID, err := s.ensureEnterpriseDefaultChat(ctx, enterpriseID, userID)
	if err != nil {
		return err
	}
	var existing string
	_ = s.db.QueryRow(ctx, `
		SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
		convID, userID).Scan(&existing)
	if existing != "" {
		return nil
	}
	role := "member"
	var ownerCount int
	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM conversation_members
		WHERE conversation_id=$1 AND role='owner'`, convID).Scan(&ownerCount)
	if ownerCount == 0 {
		role = "owner"
		_, _ = s.db.Exec(ctx, `UPDATE conversations SET owner_id=$2 WHERE id=$1`, convID, userID)
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id, role, history_visible_from)
		VALUES ($1,$2,$3, now())
		ON CONFLICT DO NOTHING`, convID, userID, role)
	return err
}
