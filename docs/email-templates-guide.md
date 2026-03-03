# Email Templates Guide

## Purpose
Maintain consistent, branded transactional emails across auth and security notifications.

## Template Principles
- Clear subject and action.
- Professional, concise language.
- Branded header styling aligned with product theme.
- Include security guidance for unexpected actions.

## Covered Templates
- Password reset
- Confirm signup
- Invite
- Magic link
- Email/phone change notifications
- Password changed
- Identity linked/unlinked
- MFA enrolled/unenrolled
- Reauthentication code
- New login detected

## Variables
Use provider-supported tokens, for example:
- `{{ .ConfirmationURL }}`
- `{{ .Email }}`
- `{{ .Token }}`
- `{{ .Provider }}`

## Safety Requirements
- Never include secrets beyond intended token fields.
- Keep links HTTPS only.
- Provide support contact for suspicious activity.

## Testing Checklist
1. Send test email for each template.
2. Verify render in Gmail and Outlook.
3. Verify plain-text fallback.
4. Verify links/variables interpolate correctly.
