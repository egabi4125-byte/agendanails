import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, QrCode } from 'lucide-react';
import { formatCurrencyBRL } from '../utils/formatters';
import {
  buildPixPayload,
  copyTextToClipboard,
  detectPixKeyLabel,
  normalizePixKey,
} from '../utils/pix';

interface PixQrDisplayProps {
  pixKey: string;
  merchantName: string;
  merchantCity?: string;
  amount: number;
  txid?: string;
  feeLabel?: string;
  compact?: boolean;
}

export const PixQrDisplay: React.FC<PixQrDisplayProps> = ({
  pixKey,
  merchantName,
  merchantCity = 'SAO PAULO',
  amount,
  txid = 'TAXAATELIER',
  feeLabel = 'Valor da Taxa',
  compact = false,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'code' | 'key' | null>(null);

  const normalizedKey = useMemo(() => normalizePixKey(pixKey), [pixKey]);
  const keyTypeLabel = useMemo(() => detectPixKeyLabel(pixKey), [pixKey]);

  const payload = useMemo(() => {
    if (!normalizedKey || amount <= 0) return '';
    return buildPixPayload({
      pixKey: normalizedKey,
      merchantName,
      merchantCity,
      amount,
      txid,
    });
  }, [normalizedKey, merchantName, merchantCity, amount, txid]);

  useEffect(() => {
    if (!payload) {
      setQrDataUrl(null);
      setQrError(false);
      return;
    }
    let cancelled = false;
    setQrError(false);
    QRCode.toDataURL(payload, {
      width: compact ? 200 : 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#16141C', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload, compact]);

  const handleCopy = async (text: string, kind: 'code' | 'key') => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind(null), 2400);
    }
  };

  if (!normalizedKey) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1">
        <p className="font-semibold">Chave Pix não informada</p>
        <p>
          Configure a chave Pix para gerar o QR Code e o código Pix Copia e Cola automaticamente.
        </p>
      </div>
    );
  }

  if (amount <= 0) {
    return (
      <div className="p-4 rounded-xl bg-[#F3F2F5] border border-[#E4E2E8] text-xs text-[#5E5B66]">
        Informe um valor maior que R$ 0,00 para gerar o QR Code Pix e o código Copia e Cola.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-[#FAFAFA] border border-[#E4E2E8] space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#7A2E4D]">
          <QrCode className="w-4 h-4" />
          <span>
            {feeLabel}:{' '}
            <span className="font-mono tabular-nums text-[#16141C]">
              {formatCurrencyBRL(amount)}
            </span>
          </span>
        </div>

        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR Code Pix para pagamento da taxa"
            className={`${compact ? 'w-44 h-44' : 'w-52 h-52'} rounded-xl bg-white p-2 border border-[#E4E2E8] shadow-xs`}
          />
        ) : qrError ? (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 text-center">
            Use o código Pix Copia e Cola abaixo para pagar pelo aplicativo do seu banco.
          </div>
        ) : (
          <div
            className={`${compact ? 'w-44 h-44' : 'w-52 h-52'} rounded-xl bg-white border border-[#E4E2E8] flex items-center justify-center text-xs text-[#5E5B66]`}
          >
            Gerando QR Code...
          </div>
        )}

        <p className="text-xs text-[#5E5B66] text-center">
          Recebedor:{' '}
          <span className="font-semibold text-[#16141C]">{merchantName}</span>
          {keyTypeLabel ? ` · ${keyTypeLabel}` : ''}
        </p>
      </div>

      {/* Chave Pix */}
      <div className="p-3.5 rounded-xl bg-[#F3F2F5] border border-[#E4E2E8] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#16141C]">
            Chave Pix ({keyTypeLabel || 'Cadastrada'})
          </span>
          <button
            type="button"
            onClick={() => handleCopy(normalizedKey, 'key')}
            className="text-xs font-semibold text-[#7A2E4D] hover:underline inline-flex items-center gap-1"
          >
            {copiedKind === 'key' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-emerald-700">Chave copiada!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar chave</span>
              </>
            )}
          </button>
        </div>
        <p className="text-xs font-mono break-all text-[#16141C] select-all">
          {normalizedKey}
        </p>
      </div>

      {/* Pix Copia e Cola */}
      {payload && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#16141C]">
            Código Pix Copia e Cola
          </label>
          <div className="p-2.5 rounded-xl border border-[#E4E2E8] bg-white text-[11px] font-mono break-all text-[#16141C] max-h-24 overflow-y-auto select-all">
            {payload}
          </div>
          <button
            type="button"
            onClick={() => handleCopy(payload, 'code')}
            className="w-full py-2.5 px-4 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
          >
            {copiedKind === 'code' ? (
              <>
                <Check className="w-4 h-4" />
                <span>Código Pix Copia e Cola copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copiar Pix Copia e Cola</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
