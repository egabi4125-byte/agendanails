function stripAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Normalizes Brazilian Pix keys to EMV BR Code standard:
 * - Email: lowercase
 * - EVP (UUID): lowercase
 * - Phone: +55XXXXXXXXXXX
 * - CPF/CNPJ: digits only (11 or 14)
 */
export function normalizePixKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';

  // Email
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  // Random EVP UUID key
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const digits = trimmed.replace(/\D/g, '');

  // Explicit international phone (+55...) or phone formatted with parentheses/spaces
  if (trimmed.startsWith('+')) {
    return digits ? `+${digits}` : '';
  }

  // Formatted CNPJ (XX.XXX.XXX/XXXX-XX) or 14 digits
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(trimmed) || digits.length === 14) {
    return digits;
  }

  // Formatted CPF (XXX.XXX.XXX-XX)
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(trimmed)) {
    return digits;
  }

  // Phone with DDD formatted like (11) 99999-9999 or 11 99999-9999
  if (/[()\s]/.test(trimmed) && (digits.length === 10 || digits.length === 11)) {
    return `+55${digits}`;
  }

  // Phone already starting with country code 55 (12 or 13 digits)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // 10-digit landline without +55
  if (digits.length === 10) {
    return `+55${digits}`;
  }

  // 11-digit pure numeric string (CPF)
  if (digits.length === 11 && /^\d{11}$/.test(trimmed)) {
    return digits;
  }

  return trimmed;
}

export function detectPixKeyLabel(rawKey: string): string {
  const normalized = normalizePixKey(rawKey);
  if (!normalized) return '';
  if (normalized.includes('@')) return 'E-mail';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return 'Chave Aleatória';
  }
  if (normalized.startsWith('+')) return 'Celular';
  if (/^\d{14}$/.test(normalized)) return 'CNPJ';
  if (/^\d{11}$/.test(normalized)) return 'CPF';
  return 'Chave Pix';
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface PixPayloadInput {
  pixKey: string;
  merchantName: string;
  merchantCity?: string;
  amount: number;
  txid?: string;
}

/**
 * Generates a standard Brazilian EMV BR Code (Pix Copia e Cola / QR Code payload).
 */
export function buildPixPayload({
  pixKey,
  merchantName,
  merchantCity = 'BRASIL',
  amount,
  txid = 'TAXAATELIER',
}: PixPayloadInput): string {
  const cleanKey = normalizePixKey(pixKey);
  if (!cleanKey) return '';

  const cleanName = (stripAccents(merchantName) || 'BYANNENAILS').slice(0, 25);
  const cleanCity = (stripAccents(merchantCity) || 'BRASIL').toUpperCase().slice(0, 15);
  const cleanTxid =
    txid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || 'TAXAATELIER';

  const merchantAccountInfo =
    tlv('00', 'br.gov.bcb.pix') + tlv('01', cleanKey);

  const amountStr = Math.max(0, amount).toFixed(2);
  const additionalData = tlv('05', cleanTxid);

  const body =
    tlv('00', '01') +
    tlv('26', merchantAccountInfo) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amount > 0 ? tlv('54', amountStr) : '') +
    tlv('58', 'BR') +
    tlv('59', cleanName) +
    tlv('60', cleanCity) +
    tlv('62', additionalData) +
    '6304';

  return body + crc16Ccitt(body);
}
