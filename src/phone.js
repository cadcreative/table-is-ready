// Normalize US phone numbers to E.164 (+1XXXXXXXXXX). Returns null if invalid.
function normalizeUSPhone(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange can't start with 0 or 1
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return '+1' + digits;
}

function formatPretty(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

module.exports = { normalizeUSPhone, formatPretty };
