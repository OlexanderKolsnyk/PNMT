// Telegram backend only. Install by REPLACING the same-named functions.
// Never install alongside duplicate function definitions.
function getOrCreateCredentialVaultKey_() {
  const key = String(PropertiesService.getScriptProperties().getProperty("CREDENTIAL_VAULT_KEY") || "");
  // This production vault is already initialized. A missing key is an outage,
  // not permission to replace the key and invalidate existing ciphertext.
  if (!key) throw new Error("Credential vault key missing; restore the existing key");
  return key;
}

function sourceAccessDenied_(source) {
  return ["Запізніла реєстрація", "Відмовлено", "Дубль"].indexOf(String(source.Status || "")) >= 0 ||
    Boolean(source.AccessStatus && source.AccessStatus !== "Активний");
}

function sourcePasswordMatches_(source, password) {
  if (sourceAccessDenied_(source)) return false;
  const hash = String(source.PasswordHash || "");
  const salt = String(source.PasswordSalt || "");
  // Partial and inconsistent credentials require explicit recovery.
  return Boolean(hash && salt) && safeCredentialEqual_(
    credentialDigestHex_(salt + ":" + String(password)), hash);
}

function hasSourceCredentialHistory_(source) {
  return ["Login", "PasswordHash", "PasswordSalt", "Password", "PasswordCiphertext",
    "CredentialIssuedAt", "CredentialDeliveredAt"].some(function(field) {
    return String(source[field] || "") !== "";
  });
}

function resolveExistingSourcePassword_(source) {
  const legacy = String(source.Password || "");
  const ciphertext = String(source.PasswordCiphertext || "");
  let decrypted = "";
  if (ciphertext) decrypted = openCredential_(ciphertext);
  // An ambiguous pair must be reviewed; never silently choose or rotate it.
  if (legacy && ciphertext && legacy !== decrypted) throw new Error("Credential recovery required");
  const password = legacy || decrypted;
  if (!password || !source.Login || !sourcePasswordMatches_(source, password)) {
    throw new Error("Credential recovery required");
  }
  return password;
}

function writeSourceCredentialFields_(sheet, headers, row, updates) {
  Object.keys(updates).forEach(function(field) {
    if (!headers[field]) throw new Error("Missing credential column: " + field);
  });
  Object.keys(updates).forEach(function(field) {
    sheet.getRange(row, headers[field]).setValue(updates[field]);
  });
}

function ensureSourceCredentials_(source, telegramId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSourceSheet();
    const fresh = readSourceRow(source.__row);
    if (String(fresh.RegistrationID || "") !== String(source.RegistrationID || "")) {
      throw new Error("Registration changed; retry");
    }
    if (sourceAccessDenied_(fresh)) return "";
    let password;
    const updates = {};
    if (hasSourceCredentialHistory_(fresh)) {
      password = resolveExistingSourcePassword_(fresh);
      // Existing credentials, hashes, salts and login are immutable here.
    } else {
      if (!fresh.RegistrationID) throw new Error("Missing registration");
      password = randomSourcePassword_(14);
      const salt = secureSourceToken_().slice(0, 32);
      updates.Login = uniqueSourceLogin_();
      updates.PasswordSalt = salt;
      updates.PasswordHash = credentialDigestHex_(salt + ":" + password);
      updates.PasswordCiphertext = sealCredential_(password);
      updates.PasswordHashScheme = "bot-v2";
      updates.AccessStatus = "Активний";
      updates.CredentialIssuedAt = new Date();
    }
    const headers = ensureSourceCredentialHeaders_();
    if (fresh.Status !== "Тестовий") updates.Status = "Дані доступу видано";
    updates.CredentialDeliveredAt = new Date();
    writeSourceCredentialFields_(sheet, headers, source.__row, updates);
    Object.keys(fresh).forEach(function(field) { source[field] = fresh[field]; });
    Object.keys(updates).forEach(function(field) { source[field] = updates[field]; });
    setParticipantField(telegramId, "Login", source.Login);
    return password;
  } finally {
    lock.releaseLock();
  }
}

function getCredentialsByTelegramId(telegramId) {
  const participant = getParticipantByTelegramId(telegramId);
  if (!participant) return null;
  const source = resolveSourceForParticipant(participant);
  if (!source) return null;
  // All records, including legacy plaintext records, use the same validation.
  const password = ensureSourceCredentials_(source, participant.TelegramID);
  if (!password) return null;
  return {
    Name: source.Name || participant.Name || "",
    Login: source.Login || "",
    Password: password,
    AccessStatus: source.AccessStatus || ""
  };
}

function generatePendingCredentials() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSourceSheet();
    const headers = ensureSourceCredentialHeaders_();
    let created = 0;
    let skipped = 0;
    const count = sheet.getLastRow() - 1;
    if (count < 1) return {created: 0, skipped: 0};
    const values = sheet.getRange(2, 1, count, sheet.getLastColumn()).getValues();
    for (let index = 0; index < values.length; index++) {
      const row = index + 2;
      const source = {};
      Object.keys(headers).forEach(function(field) { source[field] = values[index][headers[field] - 1]; });
      if (!source.RegistrationID || source.Status === "Тестовий" ||
          sourceAccessDenied_(source) || hasSourceCredentialHistory_(source)) {
        skipped++;
        continue;
      }
      const password = randomSourcePassword_(14);
      const salt = secureSourceToken_().slice(0, 32);
      const updates = {
        Login: uniqueSourceLogin_(), Status: "Дані доступу створено",
        PasswordHash: credentialDigestHex_(salt + ":" + password), PasswordSalt: salt,
        AccessStatus: "Активний", CredentialIssuedAt: new Date(),
        PasswordHashScheme: "bot-v2", PasswordCiphertext: sealCredential_(password)
      };
      // Never rewrite a whole registration row: scores can change concurrently.
      writeSourceCredentialFields_(sheet, headers, row, updates);
      created++;
    }
    return {created: created, skipped: skipped};
  } finally {
    lock.releaseLock();
  }
}
