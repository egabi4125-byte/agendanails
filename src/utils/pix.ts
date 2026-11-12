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
  const cleanKey = pixKey.trim();
  const cleanName = (stripAccents(merchantName) || 'ATELIER').slice(0, 25);
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
