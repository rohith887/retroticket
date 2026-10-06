// First sanitization pass for anything sent to the intelligence service (the Python service runs an independent second pass).
//
// What leaves the server is the customer's own words with identifying and secret-like strings masked: email addresses,
// phone numbers, links, long numbers (ids, cards), IP addresses, database ids, tokens and API keys, and passwords in
// "password: x" or "password is x" form. Quoted reply lines are dropped and the text is truncated.
// Names cannot be found by patterns; the context builder replaces known names with placeholders separately.
const MAX_TEXT_CHARS = 6000; // below the intelligence service limit (8000)

function sanitizeForAi(text, { maxChars = MAX_TEXT_CHARS } = {}) {
  let out = String(text || '').replace(/\r\n/g, '\n');
  out = out.replace(/^\s*>.*$/gm, '');
  out = out.replace(/\n\s*on .{5,120}wrote:[\s\S]*$/i, '');
  out = out
    .replace(/\b(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '[secret]')
    .replace(/\b(?:password|passcode|pwd|pin|api[-_ ]?key|secret|token)\s+(?:is|was|are|=)\s+\S+/gi, '[secret]')
    .replace(/\b(?:token|api[-_ ]?key|secret|password|passcode|pwd|authorization)\b\s*[:=]\s*\S+/gi, '[secret]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[token]')
    .replace(/\b(?:sk|pk|rk|xox[abpr]|ghp|gho|AKIA|AIza)[-_A-Za-z0-9]{12,}\b/g, '[token]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@\S+/gi, '[link]')
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[email]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, '[ip]')
    .replace(/\b[0-9a-f]{24}\b/gi, '[id]')
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, '[number]')
    .replace(/\b\d{6,}\b/g, '[number]');
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

module.exports = { sanitizeForAi, MAX_TEXT_CHARS };
