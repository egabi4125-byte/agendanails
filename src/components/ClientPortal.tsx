import React, { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Instagram,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  QrCode,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { apiRequest } from '../services/apiFallback';
import {
  Appointment,
  ClientProfile,
  ClosureDoc,
  PAYMENT_METHODS,
  PaymentMethod,
  SlotDoc,
  STUDIO_IMAGES,
  StudioConfig,
} from '../types';
import {
  buildInstagramUrl,
  buildMailtoUrl,
  buildWhatsAppUrl,
  formatCurrencyBRL,
  formatDatePtBr,
  formatShortDatePtBr,
  getHoursUntilAppointment,
  getMonthDays,
  isTimeSlotPast,
  isWithinTwoHourCancellationFee,
  makeSlotId,
  toDateKey,
  WHATSAPP_TAB_TARGET,
} from '../utils/formatters';
import { buildPixPayload } from '../utils/pix';

type ClientTab = 'agenda' | 'my_bookings' | 'location';

interface ClientPortalProps {
  uid: string;
  clientProfile: ClientProfile | null;
  appointments: Appointment[];
  slots: SlotDoc[];
  closures: ClosureDoc[];
  studioConfig: StudioConfig;
  emailVerified: boolean;
  useServerFallback?: boolean;
  onServerRefresh?: () => Promise<void>;
  onLogout: () => void;
}

export const ClientPortal: React.FC<ClientPortalProps> = ({
  uid,
  clientProfile,
  appointments,
  slots,
  closures,
  studioConfig,
  emailVerified,
  useServerFallback = false,
  onServerRefresh,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<ClientTab>('agenda');

  // Live Clock & Calendar Month State
  const [now, setNow] = useState<Date>(() => new Date());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const todayKey = useMemo(() => toDateKey(now), [now]);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(() => toDateKey(new Date()));
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // Booking Form State
  const [fullName, setFullName] = useState(clientProfile?.name || '');
  const [phone, setPhone] = useState(clientProfile?.phone === '(00) 00000-0000' ? '' : clientProfile?.phone || '');
  const [email, setEmail] = useState(clientProfile?.email || '');
  const [selectedServiceId, setSelectedServiceId] = useState(
    studioConfig.services[0]?.id || 'fibra_vidro'
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Pix');
  const [notes, setNotes] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmedReceipt, setConfirmedReceipt] = useState<Appointment | null>(null);
  const [confirmationModalAppt, setConfirmationModalAppt] = useState<Appointment | null>(null);

  const buildBookingConfirmationWhatsAppUrl = (appt: Appointment): string => {
    const msg = [
      `Olá Anne Caroline! Acabei de confirmar meu agendamento no ${studioConfig.studioName}:`,
      `• Cliente: ${appt.clientName}`,
      `• Telefone: ${appt.clientPhone}`,
      `• Data: ${formatShortDatePtBr(appt.date)} às ${appt.time}`,
      `• Serviço: ${appt.serviceName} (${formatCurrencyBRL(appt.servicePrice)})`,
      `• Pagamento após o atendimento: ${appt.paymentMethod}`,
      `• Local: ${studioConfig.address}`,
      appt.notes ? `• Obs.: ${appt.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return buildWhatsAppUrl(studioConfig.ownerPhone, msg);
  };

  // Cancel / Reschedule Modal State
  const [cancelTarget, setCancelTarget] = useState<{
    appt: Appointment;
    redirectAfter: boolean;
  } | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Pix Cancellation Fee QR Code Modal State
  const [pixFeeModalAppt, setPixFeeModalAppt] = useState<Appointment | null>(null);
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState<'code' | 'key' | null>(null);

  // Sync profile fields if clientProfile loads asynchronously
  React.useEffect(() => {
    if (clientProfile) {
      setFullName((prev) => prev || clientProfile.name);
      setPhone((prev) =>
        prev || (clientProfile.phone === '(00) 00000-0000' ? '' : clientProfile.phone)
      );
      setEmail((prev) => prev || clientProfile.email);
    }
  }, [clientProfile]);

  const monthDays = useMemo(
    () => getMonthDays(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(viewYear, viewMonth, 1));
  }, [viewYear, viewMonth]);

  // Closure lookups
  const getDayClosure = (dateKey: string): ClosureDoc | undefined => {
    return closures.find(
      (c) =>
        (c.type === 'day' && c.date === dateKey) ||
        (c.type === 'week' && dateKey >= c.date && dateKey <= c.endDate)
    );
  };

  const isSlotClosed = (dateKey: string, time: string): ClosureDoc | undefined => {
    return closures.find(
      (c) => c.type === 'slot' && c.date === dateKey && c.time === time
    );
  };

  const bookedSlotsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    slots.forEach((s) => {
      if (s.status === 'booked') {
        const set = map.get(s.date) || new Set<string>();
        set.add(s.time);
        map.set(s.date, set);
      }
    });
    return map;
  }, [slots]);

  const myConfirmedDates = useMemo(() => {
    const map = new Map<string, Appointment>();
    appointments.forEach((a) => {
      if (a.status === 'confirmed') {
        map.set(a.date, a);
      }
    });
    return map;
  }, [appointments]);

  const selectedDayClosure = getDayClosure(selectedDate);
  const existingBookingOnSelectedDate = myConfirmedDates.get(selectedDate);
  const selectedDayBookedTimes = bookedSlotsByDate.get(selectedDate) || new Set<string>();

  const selectedService =
    studioConfig.services.find((s) => s.id === selectedServiceId) ||
    studioConfig.services[0];

  const studioInstagramUrl = buildInstagramUrl(studioConfig.instagramUrl);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);

    if (!selectedTime) {
      setBookingError('Selecione um horário disponível primeiro.');
      return;
    }
    if (selectedDate < todayKey) {
      setBookingError('Não é possível agendar em datas passadas.');
      return;
    }
    if (isTimeSlotPast(selectedDate, selectedTime, new Date())) {
      setBookingError('Este horário já passou hoje. Selecione um horário futuro disponível.');
      setSelectedTime(null);
      return;
    }
    if (selectedDayClosure) {
      setBookingError(`Agenda fechada neste dia (${selectedDayClosure.reason}).`);
      return;
    }
    if (existingBookingOnSelectedDate) {
      setBookingError(
        'Você já possui 1 horário reservado neste dia. Não é permitido agendar mais de 1 horário na mesma data.'
      );
      return;
    }
    if (fullName.trim().length < 2) {
      setBookingError('Informe seu nome completo para confirmar a reserva.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 8) {
      setBookingError('Informe um telefone/WhatsApp válido.');
      return;
    }
    if (!email.trim().includes('@')) {
      setBookingError('Informe um e-mail válido para confirmação.');
      return;
    }

    setBookingLoading(true);
    const slotId = makeSlotId(selectedDate, selectedTime);
    const paymentTimingNote =
      'Pagamento realizado presencialmente após o atendimento.';

    const baseAppointmentData = {
      clientId: uid,
      clientName: fullName.trim().slice(0, 100),
      clientPhone: phone.trim().slice(0, 25),
      clientEmail: email.trim().slice(0, 120),
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      servicePrice: selectedService.price,
      date: selectedDate,
      time: selectedTime,
      slotId,
      status: 'confirmed' as const,
      paymentMethod,
      paymentTimingNote,
      paymentStatus: 'pending' as const,
      cancellationType: 'none' as const,
      cancellationFee: 0,
      notes: notes.trim().slice(0, 500),
    };

    if (useServerFallback) {
      try {
        const res = await apiRequest<{ appointment: Appointment }>(
          '/api/studio/bookings',
          {
            method: 'POST',
            body: JSON.stringify({
              ...baseAppointmentData,
              timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            }),
          }
        );
        await onServerRefresh?.();
        setConfirmedReceipt(res.appointment);
        setConfirmationModalAppt(res.appointment);
        setSelectedTime(null);
        setNotes('');
      } catch (err) {
        setBookingError(
          err instanceof Error
            ? err.message
            : 'Não foi possível concluir a reserva.'
        );
      } finally {
        setBookingLoading(false);
      }
      return;
    }

    const apptRef = doc(collection(db, 'appointments'));
    const slotRef = doc(db, 'slots', slotId);
    const lockRef = doc(db, 'clientDayLocks', `${uid}_${selectedDate}`);
    const clientRef = doc(db, 'clients', uid);

    const newAppointmentPayload = {
      ...baseAppointmentData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const batch = writeBatch(db);
      batch.set(apptRef, newAppointmentPayload);
      batch.set(slotRef, {
        date: selectedDate,
        time: selectedTime,
        status: 'booked',
        bookedByUid: uid,
        appointmentId: apptRef.id,
        createdAt: serverTimestamp(),
      });
      batch.set(lockRef, {
        clientId: uid,
        date: selectedDate,
        appointmentId: apptRef.id,
        createdAt: serverTimestamp(),
      });
      batch.update(clientRef, {
        name: fullName.trim().slice(0, 100),
        phone: phone.trim().slice(0, 25),
        email: email.trim().slice(0, 120),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      const confirmedAppt: Appointment = {
        ...newAppointmentPayload,
        id: apptRef.id,
      };
      setConfirmedReceipt(confirmedAppt);
      setConfirmationModalAppt(confirmedAppt);
      setSelectedTime(null);
      setNotes('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `appointments/${apptRef.id}`);
      } catch {
        setBookingError(
          'Não foi possível concluir a reserva. Verifique se o horário ainda está livre ou se você já possui reserva neste dia.'
        );
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const handleConfirmCancellation = async () => {
    if (!cancelTarget) return;
    const { appt, redirectAfter } = cancelTarget;
    setCancelLoading(true);

    const isLate = isWithinTwoHourCancellationFee(appt.date, appt.time);
    const fee = isLate ? studioConfig.lateCancellationFee : 0;

    const cancelledWithFeeAppt: Appointment | null =
      isLate && fee > 0
        ? {
            ...appt,
            status: 'cancelled',
            cancellationType: 'late_fee',
            cancellationFee: fee,
            paymentStatus: 'fee_pending',
          }
        : null;

    if (useServerFallback) {
      try {
        await apiRequest(`/api/studio/bookings/${appt.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({
            cancellationType: isLate ? 'late_fee' : 'free',
            cancellationFee: fee,
            paymentStatus: isLate && fee > 0 ? 'fee_pending' : 'pending',
          }),
        });
        await onServerRefresh?.();
        setCancelTarget(null);
        if (redirectAfter) {
          setActiveTab('agenda');
          setConfirmedReceipt(null);
        }
        if (cancelledWithFeeAppt) {
          setPixFeeModalAppt(cancelledWithFeeAppt);
        }
      } finally {
        setCancelLoading(false);
      }
      return;
    }

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'appointments', appt.id), {
        status: 'cancelled',
        cancellationType: isLate ? 'late_fee' : 'free',
        cancellationFee: fee,
        paymentStatus: isLate && fee > 0 ? 'fee_pending' : 'pending',
        updatedAt: serverTimestamp(),
      });
      batch.delete(doc(db, 'slots', appt.slotId));
      batch.delete(doc(db, 'clientDayLocks', `${uid}_${appt.date}`));
      await batch.commit();

      setCancelTarget(null);
      if (redirectAfter) {
        setActiveTab('agenda');
        setConfirmedReceipt(null);
      }
      if (cancelledWithFeeAppt) {
        setPixFeeModalAppt(cancelledWithFeeAppt);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `appointments/${appt.id}`);
    } finally {
      setCancelLoading(false);
    }
  };

  const pixKeyConfigured = (studioConfig.pixKey || '').trim();
  const pixPayload = useMemo(() => {
    if (!pixFeeModalAppt || !pixKeyConfigured || pixFeeModalAppt.cancellationFee <= 0) {
      return '';
    }
    return buildPixPayload({
      pixKey: pixKeyConfigured,
      merchantName: studioConfig.pixBeneficiaryName || studioConfig.studioName,
      merchantCity: studioConfig.pixCity || 'SAO PAULO',
      amount: pixFeeModalAppt.cancellationFee,
      txid: `TAXA${pixFeeModalAppt.date.replace(/-/g, '')}`,
    });
  }, [pixFeeModalAppt, pixKeyConfigured, studioConfig]);

  React.useEffect(() => {
    if (!pixPayload) {
      setPixQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(pixPayload, {
      width: 240,
      margin: 2,
      color: { dark: '#16141C', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setPixQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPixQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pixPayload]);

  const handleCopyPix = (text: string, kind: 'code' | 'key') => {
    navigator.clipboard.writeText(text);
    setPixCopied(kind);
    window.setTimeout(() => setPixCopied(null), 2200);
  };

  const sortedAppointments = useMemo(() => {
    return [...appointments].sort((a, b) => {
      if (a.status === 'confirmed' && b.status !== 'confirmed') return -1;
      if (a.status !== 'confirmed' && b.status === 'confirmed') return 1;
      return `${b.date}_${b.time}`.localeCompare(`${a.date}_${a.time}`);
    });
  }, [appointments]);

  const upcomingConfirmedCount = appointments.filter(
    (a) => a.status === 'confirmed'
  ).length;

  return (
    <div className="min-h-screen relative text-[#16141C] flex flex-col bg-[#FAFAFA]">

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-[#E4E2E8]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-6">
          <span className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#16141C] whitespace-nowrap shrink-0">
            {studioConfig.studioName}
          </span>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#5E5B66]">
            <button
              type="button"
              onClick={() => setActiveTab('agenda')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'agenda'
                  ? 'border-[#7A2E4D] text-[#16141C]'
                  : 'border-transparent hover:text-[#16141C]'
              }`}
            >
              Agenda
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('my_bookings')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'my_bookings'
                  ? 'border-[#7A2E4D] text-[#16141C]'
                  : 'border-transparent hover:text-[#16141C]'
              }`}
            >
              Meus Horários ({upcomingConfirmedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('location')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'location'
                  ? 'border-[#7A2E4D] text-[#16141C]'
                  : 'border-transparent hover:text-[#16141C]'
              }`}
            >
              Localização
            </button>
          </nav>

          <button
            type="button"
            onClick={onLogout}
            className="px-3.5 py-2 text-xs font-medium text-[#16141C] border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair</span>
          </button>
        </div>

        {/* Mobile Sub-Navigation */}
        <div className="md:hidden border-t border-[#E4E2E8] px-3 py-2 flex items-center gap-1 overflow-x-auto bg-white">
          {(
            [
              ['agenda', 'Agenda'],
              ['my_bookings', `Meus Horários (${upcomingConfirmedCount})`],
              ['location', 'Localização'],
            ] as [ClientTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === id
                  ? 'bg-[#7A2E4D] text-white'
                  : 'text-[#5E5B66] hover:bg-[#F3F2F5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 space-y-6">
        {/* Welcome Header */}
        <div className="bg-white border border-[#E4E2E8] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#5E5B66]">
              Área da Cliente · {clientProfile?.email || 'Conta conectada'}
              {!emailVerified && ' · Verifique seu e-mail para maior segurança'}
            </p>
            <h1 className="font-display text-3xl font-semibold text-[#16141C] mt-0.5">
              Olá, {clientProfile?.name || 'Cliente'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {studioInstagramUrl && (
              <a
                href={studioInstagramUrl}
                target="atelier_instagram_tab"
                className="px-4 py-2 border border-[#E4E2E8] hover:border-[#7A2E4D]/50 hover:bg-[#FAF6F8] text-[#16141C] text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Instagram className="w-4 h-4 text-[#7A2E4D]" />
                <span>Instagram do Salão</span>
                <ExternalLink className="w-3 h-3 text-[#5E5B66]" />
              </a>
            )}
            <span className="text-xs text-[#5E5B66]">
              Selecione uma data no calendário para agendar
            </span>
          </div>
        </div>

        {/* TAB: AGENDA & RESERVA */}
        {activeTab === 'agenda' && (
          <div className="space-y-6">
            {confirmedReceipt && (
              <div className="bg-white/95 backdrop-blur-sm border border-emerald-200 rounded-2xl p-6 sm:p-8 space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                        Horário confirmado automaticamente
                      </h2>
                      <p className="text-sm text-[#5E5B66] mt-0.5">
                        Sua reserva foi salva no sistema. Use o botão abaixo para enviar sua confirmação por WhatsApp ou e-mail.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmedReceipt(null)}
                    className="text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
                  >
                    Fechar aviso
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 py-4 border-y border-[#E4E2E8] text-sm">
                  <div>
                    <p className="text-xs text-[#5E5B66]">Data e Horário</p>
                    <p className="font-semibold font-mono tabular-nums mt-0.5">
                      {formatShortDatePtBr(confirmedReceipt.date)} · {confirmedReceipt.time}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5E5B66]">Procedimento</p>
                    <p className="font-semibold mt-0.5">{confirmedReceipt.serviceName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5E5B66]">Forma de Pagamento</p>
                    <p className="font-semibold mt-0.5">
                      {confirmedReceipt.paymentMethod} ({formatCurrencyBRL(confirmedReceipt.servicePrice)})
                    </p>
                    <p className="text-xs text-[#5E5B66]">Pago após o atendimento</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5E5B66]">Localização do Salão</p>
                    <p className="font-medium mt-0.5">{studioConfig.address}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={buildBookingConfirmationWhatsAppUrl(confirmedReceipt)}
                    target={WHATSAPP_TAB_TARGET}
                    className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Enviar Confirmação via WhatsApp</span>
                  </a>

                  <a
                    href={buildMailtoUrl(
                      confirmedReceipt.clientEmail,
                      `Confirmação de Horário — ${studioConfig.studioName}`,
                      `Olá ${confirmedReceipt.clientName},\n\nSeu horário está confirmado!\nData: ${formatShortDatePtBr(confirmedReceipt.date)} às ${confirmedReceipt.time}\nServiço: ${confirmedReceipt.serviceName} (${formatCurrencyBRL(confirmedReceipt.servicePrice)})\nPagamento (${confirmedReceipt.paymentMethod}) será realizado após o atendimento.\nLocal: ${studioConfig.address}\n\nPolítica: Cancelamento gratuito até 2 horas antes do horário.`
                    )}
                    className="px-4 py-2.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Mail className="w-4 h-4" />
                    <span>Enviar Aviso por E-mail</span>
                  </a>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Monthly Calendar */}
              <section className="lg:col-span-7 bg-white/95 backdrop-blur-sm border border-[#E4E2E8] rounded-2xl p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl font-semibold capitalize text-[#16141C]">
                      {monthLabel}
                    </h2>
                    <p className="text-xs text-[#5E5B66]">
                      Selecione um dia para ver horários ocupados, livres ou bloqueados
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      aria-label="Mês anterior"
                      className="p-2 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-lg transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      aria-label="Próximo mês"
                      className="p-2 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-lg transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Weekday Header */}
                <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-[#5E5B66]">
                  {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
                    <div key={d} className="py-1.5">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar Cells */}
                <div className="grid grid-cols-7 gap-1.5">
                  {monthDays.map((dateObj, idx) => {
                    if (!dateObj) {
                      return <div key={`empty_${idx}`} className="h-16 sm:h-20" />;
                    }
                    const dKey = toDateKey(dateObj);
                    const isPast = dKey < todayKey;
                    const closure = getDayClosure(dKey);
                    const bookedSet = bookedSlotsByDate.get(dKey);
                    const availableCount = studioConfig.workingHours.filter(
                      (h) =>
                        !bookedSet?.has(h) &&
                        !isSlotClosed(dKey, h) &&
                        !isTimeSlotPast(dKey, h, now)
                    ).length;
                    const allPastToday =
                      dKey === todayKey &&
                      studioConfig.workingHours.every((h) =>
                        isTimeSlotPast(dKey, h, now)
                      );
                    const hasMyBooking = myConfirmedDates.has(dKey);
                    const isSelected = selectedDate === dKey;

                    return (
                      <button
                        key={dKey}
                        type="button"
                        onClick={() => {
                          setSelectedDate(dKey);
                          setSelectedTime(null);
                          setBookingError(null);
                        }}
                        className={`h-16 sm:h-20 p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-colors ${
                          isSelected
                            ? 'border-[#7A2E4D] bg-[#7A2E4D]/5 ring-1 ring-[#7A2E4D]'
                            : closure
                            ? 'border-red-200 bg-red-50/70 text-red-900'
                            : isPast || allPastToday
                            ? 'border-[#E4E2E8]/60 bg-[#F3F2F5]/50 text-[#5E5B66]/60'
                            : 'border-[#E4E2E8] bg-white hover:bg-[#F3F2F5]/60'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs sm:text-sm font-mono tabular-nums font-semibold">
                            {dateObj.getDate()}
                          </span>
                          {closure && <Lock className="w-3 h-3 text-red-700 shrink-0" />}
                          {!closure && hasMyBooking && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#7A2E4D] shrink-0" />
                          )}
                        </div>

                        <div className="text-[10px] leading-tight truncate">
                          {closure ? (
                            <span className="text-red-700 font-medium">Fechada</span>
                          ) : isPast || allPastToday ? (
                            <span>Encerrado</span>
                          ) : hasMyBooking ? (
                            <span className="text-[#7A2E4D] font-semibold">Reservado</span>
                          ) : availableCount === 0 ? (
                            <span className="text-amber-700 font-medium">Lotado</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">
                              {availableCount} vagas
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="pt-3 border-t border-[#E4E2E8] flex flex-wrap items-center gap-4 text-xs text-[#5E5B66]">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#7A2E4D]" />
                    <span>Seu agendamento</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-red-700" />
                    <span>Agenda fechada (dia/semana)</span>
                  </span>
                  <span>Vagas em verde indicam horários livres</span>
                </div>
              </section>

              {/* Right: Day Slots & Booking Form */}
              <section className="lg:col-span-5 bg-white/95 backdrop-blur-sm border border-[#E4E2E8] rounded-2xl p-5 sm:p-6 space-y-5">
                <div className="border-b border-[#E4E2E8] pb-4">
                  <p className="text-xs text-[#5E5B66] flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>Horários do dia selecionado</span>
                  </p>
                  <h3 className="font-display text-2xl font-semibold text-[#16141C] capitalize mt-0.5">
                    {formatDatePtBr(selectedDate)}
                  </h3>
                </div>

                {selectedDate < todayKey ? (
                  <div className="p-4 rounded-xl bg-[#F3F2F5] text-sm text-[#5E5B66]">
                    Esta data já passou. Selecione hoje ou um dia futuro no calendário para agendar.
                  </div>
                ) : selectedDayClosure ? (
                  <div className="p-5 rounded-xl bg-red-50 border border-red-200 space-y-2">
                    <div className="flex items-center gap-2 text-red-800 font-semibold text-sm">
                      <Lock className="w-4 h-4" />
                      <span>
                        Agenda fechada pela proprietária (
                        {selectedDayClosure.type === 'week' ? 'Semana fechada' : 'Dia fechado'})
                      </span>
                    </div>
                    <p className="text-sm text-red-900">
                      Motivo: {selectedDayClosure.reason}
                    </p>
                    <p className="text-xs text-red-700">
                      Não é possível realizar agendamentos em datas fechadas. Escolha outro dia disponível no calendário.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Notice if client already booked on this day */}
                    {existingBookingOnSelectedDate && (
                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-sm text-amber-950">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>Você já tem 1 horário neste dia ({existingBookingOnSelectedDate.time})</span>
                        </div>
                        <p className="text-xs text-amber-900">
                          Por regra do estúdio, não é permitido agendar mais de 1 horário no mesmo dia. Caso deseje trocar, cancele ou altere em Meus Horários.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('my_bookings')}
                          className="text-xs font-semibold text-[#7A2E4D] hover:underline"
                        >
                          Gerenciar meu horário &rarr;
                        </button>
                      </div>
                    )}

                    {/* Slot Grid */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-[#16141C]">
                        Disponibilidade ({studioConfig.workingHours.length} horários no dia)
                      </p>
                      {selectedDate === todayKey &&
                        studioConfig.workingHours.every((h) =>
                          isTimeSlotPast(selectedDate, h, now)
                        ) && (
                          <div className="p-3 rounded-xl bg-[#F3F2F5] text-xs text-[#5E5B66]">
                            Todos os horários de hoje já passaram. Selecione amanhã ou outra data futura no calendário para agendar.
                          </div>
                        )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {studioConfig.workingHours.map((time) => {
                          const isBooked = selectedDayBookedTimes.has(time);
                          const slotClosure = isSlotClosed(selectedDate, time);
                          const isPastTime = isTimeSlotPast(selectedDate, time, now);
                          const isMySlot =
                            existingBookingOnSelectedDate?.time === time;
                          const isDisabled =
                            isBooked ||
                            Boolean(slotClosure) ||
                            isPastTime ||
                            Boolean(existingBookingOnSelectedDate);
                          const isChosen = selectedTime === time;

                          return (
                            <button
                              key={time}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => {
                                setSelectedTime(time);
                                setBookingError(null);
                              }}
                              className={`py-2.5 px-3 rounded-xl border text-left transition-colors ${
                                isMySlot
                                  ? 'border-[#7A2E4D] bg-[#7A2E4D]/10 text-[#7A2E4D]'
                                  : isChosen
                                  ? 'border-[#7A2E4D] bg-[#7A2E4D] text-white'
                                  : isBooked || slotClosure || isPastTime
                                  ? 'border-[#E4E2E8] bg-[#F3F2F5] text-[#5E5B66]/70 cursor-not-allowed'
                                  : existingBookingOnSelectedDate
                                  ? 'border-[#E4E2E8] bg-white text-[#5E5B66]/60 cursor-not-allowed'
                                  : 'border-[#E4E2E8] bg-white hover:border-[#7A2E4D] text-[#16141C]'
                              }`}
                            >
                              <div className="text-sm font-mono tabular-nums font-semibold">
                                {time}
                              </div>
                              <div className="text-[11px] mt-0.5 truncate">
                                {isMySlot
                                  ? 'Seu horário'
                                  : isBooked
                                  ? 'Ocupado'
                                  : slotClosure
                                  ? 'Fechado'
                                  : isPastTime
                                  ? 'Encerrado'
                                  : isChosen
                                  ? 'Selecionado'
                                  : 'Disponível'}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Booking Form when time selected */}
                    {selectedTime && !existingBookingOnSelectedDate && (
                      <form
                        onSubmit={handleCreateBooking}
                        className="pt-4 border-t border-[#E4E2E8] space-y-4"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold text-[#16141C]">
                            Confirmar reserva para {selectedTime}
                          </h4>
                          <span className="text-xs font-mono tabular-nums text-[#7A2E4D] font-semibold">
                            {formatShortDatePtBr(selectedDate)}
                          </span>
                        </div>

                        {bookingError && (
                          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                            {bookingError}
                          </div>
                        )}

                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-[#16141C] mb-1">
                              Nome completo *
                            </label>
                            <input
                              type="text"
                              required
                              value={fullName}
                              onChange={(e) => setFullName(e.target.value)}
                              className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-[#16141C] mb-1">
                                Telefone (WhatsApp) *
                              </label>
                              <input
                                type="tel"
                                required
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="(11) 99999-9999"
                                className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#16141C] mb-1">
                                E-mail *
                              </label>
                              <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#16141C] mb-1">
                              Serviço desejado
                            </label>
                            <select
                              value={selectedServiceId}
                              onChange={(e) => setSelectedServiceId(e.target.value)}
                              className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                            >
                              {studioConfig.services.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} — {formatCurrencyBRL(s.price)} ({s.durationMin} min)
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#16141C] mb-1">
                              Forma de pagamento (pago após o atendimento)
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              {PAYMENT_METHODS.map((pm) => (
                                <button
                                  key={pm}
                                  type="button"
                                  onClick={() => setPaymentMethod(pm)}
                                  className={`py-2 px-3 text-xs font-medium rounded-xl border transition-colors ${
                                    paymentMethod === pm
                                      ? 'border-[#7A2E4D] bg-[#7A2E4D]/10 text-[#7A2E4D]'
                                      : 'border-[#E4E2E8] bg-white text-[#5E5B66] hover:text-[#16141C]'
                                  }`}
                                >
                                  {pm}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#16141C] mb-1">
                              Observações (opcional)
                            </label>
                            <input
                              type="text"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Ex: formato amendoado, francesinha..."
                              className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                            />
                          </div>
                        </div>

                        {/* Payment & Cancellation Policy Notice (Shown at Booking Time) */}
                        <div className="p-4 rounded-xl bg-[#F3F2F5] border border-[#E4E2E8] space-y-2 text-xs text-[#16141C]">
                          <p className="font-semibold text-[#16141C]">
                            Informações do Agendamento
                          </p>
                          <p>
                            <span className="font-semibold">Pagamento após o atendimento:</span>{' '}
                            O valor de{' '}
                            <span className="font-mono tabular-nums font-semibold">
                              {formatCurrencyBRL(selectedService.price)}
                            </span>{' '}
                            ({paymentMethod}) será pago presencialmente após a conclusão do seu atendimento.
                          </p>
                          <p className="text-[#5E5B66]">
                            <span className="font-semibold text-[#16141C]">Cancelamento:</span>{' '}
                            Gratuito com até 2 horas de antecedência. Cancelamentos após esse prazo (menos de 2h antes) terão cobrança de taxa de{' '}
                            <span className="font-mono tabular-nums font-semibold text-[#16141C]">
                              {formatCurrencyBRL(studioConfig.lateCancellationFee)}
                            </span>
                            .
                          </p>
                        </div>

                        {/* Salon Location Preview */}
                        <div className="p-3.5 rounded-xl border border-[#E4E2E8] bg-white space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#16141C] inline-flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-[#7A2E4D]" />
                              Localização do Salão
                            </span>
                            {studioConfig.mapsUrl && (
                              <a
                                href={studioConfig.mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#7A2E4D] font-medium hover:underline inline-flex items-center gap-1"
                              >
                                <span>Ver mapa</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-[#5E5B66]">{studioConfig.address}</p>
                        </div>

                        <button
                          type="submit"
                          disabled={bookingLoading}
                          className="w-full py-3 px-5 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                        >
                          {bookingLoading ? 'Confirmando reserva...' : 'Confirmar Agendamento'}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        )}

        {/* TAB: MEUS HORÁRIOS */}
        {activeTab === 'my_bookings' && (
          <section className="bg-white/95 backdrop-blur-sm border border-[#E4E2E8] rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E2E8] pb-4">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                  Meus Agendamentos
                </h2>
                <p className="text-sm text-[#5E5B66]">
                  Cancelamentos realizados com até 2 horas de antecedência são gratuitos. Após esse prazo, aplica-se taxa de {formatCurrencyBRL(studioConfig.lateCancellationFee)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('agenda')}
                className="px-4 py-2 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                Novo Agendamento
              </button>
            </div>

            {sortedAppointments.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-[#5E5B66]">
                  Você ainda não possui horários agendados.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('agenda')}
                  className="px-4 py-2 bg-[#7A2E4D] text-white text-xs font-semibold rounded-xl"
                >
                  Escolher um horário no calendário
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#E4E2E8]">
                {sortedAppointments.map((appt) => {
                  const hoursLeft = getHoursUntilAppointment(appt.date, appt.time);
                  const isLateWindow = hoursLeft < 2;

                  return (
                    <div
                      key={appt.id}
                      className="py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#5E5B66]">
                          <span className="font-mono tabular-nums font-semibold text-[#16141C]">
                            {formatShortDatePtBr(appt.date)} · {appt.time}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {appt.status === 'confirmed'
                              ? 'Confirmado'
                              : appt.status === 'completed'
                              ? 'Atendimento concluído'
                              : appt.cancellationType === 'late_fee'
                              ? `Cancelado com taxa (${formatCurrencyBRL(appt.cancellationFee)}${appt.paymentStatus === 'paid' ? ' · Taxa paga' : ' · Pendente'})`
                              : 'Cancelado gratuitamente'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {appt.paymentMethod} ({formatCurrencyBRL(appt.servicePrice)})
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-[#16141C]">
                          {appt.serviceName}
                        </h3>

                        <p className="text-xs text-[#5E5B66]">
                          {appt.paymentTimingNote || 'Pagamento após o atendimento'} · Local: {studioConfig.address}
                        </p>

                        {appt.status === 'confirmed' && (
                          <p
                            className={`text-xs font-medium inline-flex items-center gap-1.5 ${
                              isLateWindow ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            {hoursLeft <= 0
                              ? 'Horário em andamento ou expirado — cancelamento sujeito à taxa'
                              : isLateWindow
                              ? `Faltam menos de 2h — cancelamento sujeito à taxa de ${formatCurrencyBRL(studioConfig.lateCancellationFee)}`
                              : 'Cancelamento gratuito disponível (mais de 2h até o atendimento)'}
                          </p>
                        )}
                      </div>

                      {appt.status === 'cancelled' &&
                        appt.cancellationType === 'late_fee' &&
                        appt.cancellationFee > 0 &&
                        appt.paymentStatus === 'fee_pending' && (
                          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setPixFeeModalAppt(appt)}
                              className="px-4 py-2 bg-[#7A2E4D] hover:bg-[#61233C] text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              <span>Pagar Taxa via Pix (QR Code)</span>
                            </button>
                          </div>
                        )}

                      {appt.status === 'confirmed' && (
                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <a
                            href={buildWhatsAppUrl(
                              studioConfig.ownerPhone,
                              `Olá Anne Caroline! Sobre meu horário de ${formatShortDatePtBr(appt.date)} às ${appt.time} (${appt.serviceName}).`
                            )}
                            target={WHATSAPP_TAB_TARGET}
                            className="px-3.5 py-2 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#16141C] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                            <span>WhatsApp</span>
                          </a>

                          <button
                            type="button"
                            onClick={() =>
                              setCancelTarget({ appt, redirectAfter: true })
                            }
                            className="px-3.5 py-2 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#16141C] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Reservar outro horário</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setCancelTarget({ appt, redirectAfter: false })
                            }
                            className="px-3.5 py-2 border border-red-200 hover:bg-red-50 rounded-xl text-xs font-medium text-red-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancelar horário</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB: LOCALIZAÇÃO DO SALÃO */}
        {activeTab === 'location' && (
          <section className="bg-white/95 backdrop-blur-sm border border-[#E4E2E8] rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-5">
              <div>
                <p className="text-xs text-[#5E5B66]">Onde nos encontrar</p>
                <h2 className="font-display text-3xl font-semibold text-[#16141C] mt-1">
                  Localização do {studioConfig.studioName}
                </h2>
              </div>

              <div className="space-y-3 text-sm border-t border-[#E4E2E8] pt-4">
                <div>
                  <p className="text-xs font-semibold text-[#5E5B66]">Endereço</p>
                  <p className="text-base font-medium text-[#16141C] mt-0.5">
                    {studioConfig.address || 'Endereço ainda não informado pela proprietária.'}
                  </p>
                </div>

                {studioConfig.referencePoint && (
                  <div>
                    <p className="text-xs font-semibold text-[#5E5B66]">
                      Ponto de Referência
                    </p>
                    <p className="text-sm text-[#16141C] mt-0.5">
                      {studioConfig.referencePoint}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <p className="text-xs font-semibold text-[#5E5B66]">WhatsApp do Salão</p>
                    <p className="font-mono tabular-nums text-sm mt-0.5">
                      {studioConfig.ownerPhone}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#5E5B66]">E-mail</p>
                    <p className="text-sm mt-0.5">{studioConfig.ownerEmail}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {studioConfig.mapsUrl && (
                  <a
                    href={studioConfig.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <MapPin className="w-4 h-4" />
                    <span>Abrir no Google Maps</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <a
                  href={buildWhatsAppUrl(
                    studioConfig.ownerPhone,
                    'Olá Anne Caroline! Gostaria de confirmar o endereço/localização do salão.'
                  )}
                  target={WHATSAPP_TAB_TARGET}
                  className="px-4 py-2.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-700" />
                  <span>Falar no WhatsApp</span>
                </a>

                {studioInstagramUrl && (
                  <a
                    href={studioInstagramUrl}
                    target="atelier_instagram_tab"
                    className="px-4 py-2.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Instagram className="w-4 h-4 text-[#7A2E4D]" />
                    <span>Instagram</span>
                    <ExternalLink className="w-3.5 h-3.5 text-[#5E5B66]" />
                  </a>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 rounded-2xl overflow-hidden border border-[#E4E2E8] aspect-[4/3] bg-[#F3F2F5] relative">
              <img
                src={STUDIO_IMAGES.hero}
                alt="Ambiente do Atelier Anne Caroline"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </section>
        )}
      </main>

      {/* Floating WhatsApp Button to Owner (Logo Only) */}
      <a
        href={buildWhatsAppUrl(
          studioConfig.ownerPhone,
          `Olá Anne Caroline! Estou entrando em contato pela agenda do ${studioConfig.studioName}.`
        )}
        target={WHATSAPP_TAB_TARGET}
        aria-label="Falar com a proprietária no WhatsApp"
        title="Falar com Anne Caroline no WhatsApp"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
      >
        <img
          src="/assets/aistudio/WhatsApp.svg_374c9d2d.webp"
          alt="WhatsApp"
          className="w-14 h-14 object-contain drop-shadow-lg"
        />
      </a>

      {/* Cancel / Reschedule Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="space-y-2">
              <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                {cancelTarget.redirectAfter
                  ? 'Cancelar para reservar outro horário'
                  : 'Confirmar cancelamento'}
              </h3>
              <p className="text-sm text-[#5E5B66]">
                Agendamento de{' '}
                <span className="font-semibold text-[#16141C]">
                  {formatShortDatePtBr(cancelTarget.appt.date)} às {cancelTarget.appt.time}
                </span>{' '}
                ({cancelTarget.appt.serviceName}).
              </p>
            </div>

            {isWithinTwoHourCancellationFee(
              cancelTarget.appt.date,
              cancelTarget.appt.time
            ) ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5 text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Aviso de Taxa (menos de 2 horas para o atendimento)</span>
                </p>
                <p>
                  Como faltam menos de 2 horas para o horário marcado (ou o horário já passou), este cancelamento está sujeito à taxa de{' '}
                  <span className="font-mono tabular-nums font-bold">
                    {formatCurrencyBRL(studioConfig.lateCancellationFee)}
                  </span>
                  .
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                <p className="font-semibold">Cancelamento Gratuito</p>
                <p>
                  Você está cancelando com mais de 2 horas de antecedência. Nenhuma taxa será cobrada.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={cancelLoading}
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
              >
                Manter horário
              </button>
              <button
                type="button"
                disabled={cancelLoading}
                onClick={handleConfirmCancellation}
                className="px-4 py-2.5 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                {cancelLoading
                  ? 'Cancelando...'
                  : cancelTarget.redirectAfter
                  ? 'Confirmar e Escolher Novo Horário'
                  : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pix QR Code Modal for Late Cancellation Fee */}
      {pixFeeModalAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-md w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#7A2E4D]">
                  Pagamento da Taxa de Cancelamento
                </p>
                <h3 className="font-display text-2xl font-semibold text-[#16141C] mt-0.5">
                  Pix QR Code · {formatCurrencyBRL(pixFeeModalAppt.cancellationFee)}
                </h3>
                <p className="text-xs text-[#5E5B66] mt-0.5">
                  Referente ao horário de {formatShortDatePtBr(pixFeeModalAppt.date)} às {pixFeeModalAppt.time}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPixFeeModalAppt(null)}
                aria-label="Fechar janela Pix"
                className="p-1.5 text-[#5E5B66] hover:text-[#16141C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pixKeyConfigured ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-[#FAFAFA] border border-[#E4E2E8] space-y-3">
                  {pixQrDataUrl ? (
                    <img
                      src={pixQrDataUrl}
                      alt="QR Code Pix para pagamento da taxa"
                      className="w-52 h-52 rounded-xl bg-white p-2 border border-[#E4E2E8]"
                    />
                  ) : (
                    <div className="w-52 h-52 rounded-xl bg-white border border-[#E4E2E8] flex items-center justify-center text-xs text-[#5E5B66]">
                      Gerando QR Code...
                    </div>
                  )}
                  <p className="text-xs text-[#5E5B66] text-center">
                    Recebedor:{' '}
                    <span className="font-semibold text-[#16141C]">
                      {studioConfig.pixBeneficiaryName || studioConfig.studioName}
                    </span>
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F3F2F5] border border-[#E4E2E8] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#16141C]">
                      Chave Pix
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyPix(pixKeyConfigured, 'key')}
                      className="text-xs font-semibold text-[#7A2E4D] hover:underline inline-flex items-center gap-1"
                    >
                      {pixCopied === 'key' ? (
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
                  <p className="text-xs font-mono break-all text-[#16141C]">
                    {pixKeyConfigured}
                  </p>
                </div>

                {pixPayload && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[#16141C]">
                      Pix Copia e Cola
                    </label>
                    <div className="p-2.5 rounded-xl border border-[#E4E2E8] bg-white text-[11px] font-mono break-all text-[#5E5B66] max-h-20 overflow-y-auto">
                      {pixPayload}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyPix(pixPayload, 'code')}
                      className="w-full py-2.5 px-4 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      {pixCopied === 'code' ? (
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
            ) : (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <p className="font-semibold">Chave Pix ainda não cadastrada pelo estúdio</p>
                <p>
                  Entre em contato pelo WhatsApp abaixo para receber a chave Pix e quitar a taxa de {formatCurrencyBRL(pixFeeModalAppt.cancellationFee)}.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E4E2E8]">
              <a
                href={buildWhatsAppUrl(
                  studioConfig.ownerPhone,
                  `Olá Anne Caroline! Segue o comprovante do pagamento via Pix da taxa de cancelamento (${formatCurrencyBRL(pixFeeModalAppt.cancellationFee)}) do horário de ${formatShortDatePtBr(pixFeeModalAppt.date)} às ${pixFeeModalAppt.time}.`
                )}
                target={WHATSAPP_TAB_TARGET}
                className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Enviar comprovante no WhatsApp</span>
              </a>

              <button
                type="button"
                onClick={() => setPixFeeModalAppt(null)}
                className="px-4 py-2 text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Booking Confirmation Notification Modal */}
      {confirmationModalAppt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-confirmed-title"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-md w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-700">
                    Notificação de Agendamento
                  </p>
                  <h3
                    id="booking-confirmed-title"
                    className="font-display text-2xl font-semibold text-[#16141C] mt-0.5"
                  >
                    Horário confirmado!
                  </h3>
                  <p className="text-xs text-[#5E5B66] mt-0.5">
                    Sua reserva foi registrada no sistema com sucesso.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmationModalAppt(null)}
                aria-label="Fechar notificação"
                className="p-1.5 text-[#5E5B66] hover:text-[#16141C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E4E2E8] space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#5E5B66]">Data e horário</span>
                <span className="font-semibold font-mono tabular-nums text-[#16141C]">
                  {formatShortDatePtBr(confirmationModalAppt.date)} · {confirmationModalAppt.time}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#5E5B66]">Serviço</span>
                <span className="font-semibold text-[#16141C] text-right">
                  {confirmationModalAppt.serviceName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#5E5B66]">Pagamento</span>
                <span className="font-semibold text-[#16141C] text-right">
                  {confirmationModalAppt.paymentMethod} ({formatCurrencyBRL(confirmationModalAppt.servicePrice)})
                </span>
              </div>
              <div className="pt-2 border-t border-[#E4E2E8] space-y-1">
                <p className="text-[#5E5B66]">
                  <span className="font-semibold text-[#16141C]">Local:</span>{' '}
                  {studioConfig.address}
                </p>
                <p className="text-[#5E5B66]">
                  Pagamento presencial após o atendimento. Cancelamento gratuito até 2h antes.
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              <a
                href={buildBookingConfirmationWhatsAppUrl(confirmationModalAppt)}
                target={WHATSAPP_TAB_TARGET}
                onClick={() => setConfirmationModalAppt(null)}
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Enviar confirmação por WhatsApp</span>
              </a>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={buildMailtoUrl(
                    confirmationModalAppt.clientEmail,
                    `Confirmação de Horário — ${studioConfig.studioName}`,
                    `Olá ${confirmationModalAppt.clientName},\n\nSeu horário está confirmado!\nData: ${formatShortDatePtBr(confirmationModalAppt.date)} às ${confirmationModalAppt.time}\nServiço: ${confirmationModalAppt.serviceName} (${formatCurrencyBRL(confirmationModalAppt.servicePrice)})\nPagamento (${confirmationModalAppt.paymentMethod}) será realizado após o atendimento.\nLocal: ${studioConfig.address}\n\nPolítica: Cancelamento gratuito até 2 horas antes do horário.`
                  )}
                  className="py-2.5 px-3 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Enviar por E-mail</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmationModalAppt(null);
                    setActiveTab('my_bookings');
                  }}
                  className="py-2.5 px-3 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-semibold rounded-xl transition-colors"
                >
                  Ver Meus Horários
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirmationModalAppt(null)}
                className="text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
              >
                Fechar notificação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
