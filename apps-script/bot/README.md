# Telegram credential safety

`CredentialSafety.gs` contains replacements for the Telegram backend, not the website project. Replace the five existing functions `getOrCreateCredentialVaultKey_`, `sourcePasswordMatches_`, `ensureSourceCredentials_`, `getCredentialsByTelegramId`, and `generatePendingCredentials`, and add the four supporting helpers. Do not retain duplicate definitions. Keep the existing cipher implementation and its key. This existing production vault must fail closed if its key is missing; automatic key replacement is disabled.

Existing records must have a recoverable password, a login, and a matching complete SHA-256 hash/salt pair. Repeated issuance preserves the password, login, ciphertext, salt, hash, issue timestamp and scores. Denied, late and duplicate records are not activated. Test status is preserved. Conflicting, incomplete, corrupt and hash-only records require explicit recovery; they never cause password regeneration.

Only a registration without any credential history can receive a newly generated pair. The scheduled generator skips every existing credential record and writes credential fields individually, so concurrent score updates are not overwritten.

The website continues to verify SHA-256(salt + ":" + password), with its existing throttling. Inconsistent legacy data requires a separately approved repair from the existing password and salt. Do not add a plaintext fallback to website authentication, reset passwords in bulk, clear legacy passwords without a migration plan, or regenerate the vault key.

Run `node scripts/test-bot-credentials.js` from the repository root.
