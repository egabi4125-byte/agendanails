import React, { useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Copy,
  DollarSign,
  Edit3,
  Instagram,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Plus,
  QrCode,
  Search,
  Trash2,
  Unlock,
  UserPlus,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { apiRequest } from '../services/apiFallback';
import {
  Appointment,
  AppointmentStatus,
  ClientProfile,
  ClosureDoc,
  FinanceEntry,
  NailService,
  PAYMENT_METHODS,
  PaymentMethod,
  SlotDoc,
  STUDIO_IMAGES,
  StudioConfig,
} from '../types';
import {
  buildWhatsAppUrl,
  formatCurrencyBRL,
  formatShortDatePtBr,
  getWeekDatesFrom,
  makeSlotId,
  toDateKey,
  WHATSAPP_TAB_TARGET,
} from '../utils/formatters';

type OwnerTab = 'agenda' | 'clients' | 'closures' | 'finance' | 'location';

interface OwnerPortalProps {
  ownerUid: string;
  clients: ClientProfile[];
  appointments: Appointment[];
  slots: SlotDoc[];
  closures: ClosureDoc[];
  finances: FinanceEntry[];
  studioConfig: StudioConfig;
  useServerFallback?: boolean;
  onServerRefresh?: () => Promise<void>;
  onLogout: () => void;
}

export const OwnerPortal: React.FC<OwnerPortalProps> = ({
  ownerUid,
  clients,
  appointments,
  slots,
  closures,
  finances,
  studioConfig,
  useServerFallback = false,
  onServerRefresh,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<OwnerTab>('agenda');
  const todayKey = useMemo(() => toDateKey(new Date()), []);

  // Agenda Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AppointmentStatus>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Create/Edit Appointment Modal
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [selectedExistingClientId, setSelectedExistingClientId] = useState<string>('new');
  const [formClientName, setFormClientName] = useState('');
  const [formClientPhone, setFormClientPhone] = useState('');
  const [formClientEmail, setFormClientEmail] = useState('');
  const [formServiceId, setFormServiceId] = useState(
    studioConfig.services[0]?.id || 'fibra_vidro'
  );
  const [formDate, setFormDate] = useState(todayKey);
  const [formTime, setFormTime] = useState(studioConfig.workingHours[0] || '08:30');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>('Pix');
  const [formStatus, setFormStatus] = useState<AppointmentStatus>('confirmed');
  const [formNotes, setFormNotes] = useState('');
  const [apptSaving, setApptSaving] = useState(false);
  const [apptFormError, setApptFormError] = useState<string | null>(null);

  // Ready-Made WhatsApp Message Modal
  const [waModalAppt, setWaModalAppt] = useState<Appointment | null>(null);
  const [waCustomMessage, setWaCustomMessage] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Client Modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // Closure Form
  const [closureType, setClosureType] = useState<'day' | 'week' | 'slot'>('day');
  const [closureDate, setClosureDate] = useState(todayKey);
  const [closureTime, setClosureTime] = useState(studioConfig.workingHours[0] || '08:30');
  const [closureReason, setClosureReason] = useState('');
  const [closureSaving, setClosureSaving] = useState(false);

  // Finance Form
  const [finDate, setFinDate] = useState(todayKey);
  const [finAmount, setFinAmount] = useState('');
  const [finMethod, setFinMethod] = useState<PaymentMethod>('Pix');
  const [finType, setFinType] = useState<'income' | 'fee'>('income');
  const [finClientName, setFinClientName] = useState('');
  const [finDesc, setFinDesc] = useState('');
  const [finSaving, setFinSaving] = useState(false);

  // Studio Settings / Location Form
  const [cfgName, setCfgName] = useState(studioConfig.studioName);
  const [cfgAddress, setCfgAddress] = useState(studioConfig.address);
  const [cfgRef, setCfgRef] = useState(studioConfig.referencePoint);
  const [cfgMaps, setCfgMaps] = useState(studioConfig.mapsUrl);
  const [cfgPhone, setCfgPhone] = useState(studioConfig.ownerPhone);
  const [cfgEmail, setCfgEmail] = useState(studioConfig.ownerEmail);
  const [cfgInstagram, setCfgInstagram] = useState(studioConfig.instagramUrl || '');
  const [cfgLateFee, setCfgLateFee] = useState(String(studioConfig.lateCancellationFee));
  const [cfgPixKey, setCfgPixKey] = useState(studioConfig.pixKey || '');
  const [cfgPixBeneficiaryName, setCfgPixBeneficiaryName] = useState(
    studioConfig.pixBeneficiaryName || 'Anne Caroline'
  );
  const [cfgPixCity, setCfgPixCity] = useState(studioConfig.pixCity || 'SAO PAULO');
  const [cfgHoursText, setCfgHoursText] = useState(studioConfig.workingHours.join(', '));
  const [cfgServices, setCfgServices] = useState<NailService[]>(studioConfig.services);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgSavedBanner, setCfgSavedBanner] = useState(false);

  React.useEffect(() => {
    setCfgName(studioConfig.studioName);
    setCfgAddress(studioConfig.address);
    setCfgRef(studioConfig.referencePoint);
    setCfgMaps(studioConfig.mapsUrl);
    setCfgPhone(studioConfig.ownerPhone);
    setCfgEmail(studioConfig.ownerEmail);
    setCfgInstagram(studioConfig.instagramUrl || '');
    setCfgLateFee(String(studioConfig.lateCancellationFee));
    setCfgPixKey(studioConfig.pixKey || '');
    setCfgPixBeneficiaryName(studioConfig.pixBeneficiaryName || 'Anne Caroline');
    setCfgPixCity(studioConfig.pixCity || 'SAO PAULO');
    setCfgHoursText(studioConfig.workingHours.join(', '));
    setCfgServices(studioConfig.services);
  }, [studioConfig]);

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    return [...appointments]
      .filter((a) => {
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
        if (dateFilter && a.date !== dateFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            a.clientName.toLowerCase().includes(q) ||
            a.clientPhone.toLowerCase().includes(q) ||
            a.serviceName.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => `${b.date}_${b.time}`.localeCompare(`${a.date}_${a.time}`));
  }, [appointments, statusFilter, dateFilter, searchQuery]);

  // Financial Metrics
  const financeMetrics = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);
    const weekStartKey = toDateKey(weekAgo);
    const monthPrefix = todayKey.slice(0, 7);

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    let allTotal = 0;
    const byMethod: Record<PaymentMethod, number> = {
      Pix: 0,
      'Cartão de Crédito': 0,
      'Cartão de Débito': 0,
      Dinheiro: 0,
    };

    finances.forEach((f) => {
      allTotal += f.amount;
      if (f.date === todayKey) todayTotal += f.amount;
      if (f.date >= weekStartKey && f.date <= todayKey) weekTotal += f.amount;
      if (f.date.startsWith(monthPrefix)) monthTotal += f.amount;
      if (byMethod[f.paymentMethod] !== undefined) {
        byMethod[f.paymentMethod] += f.amount;
      }
    });

    return { todayTotal, weekTotal, monthTotal, allTotal, byMethod };
  }, [finances, todayKey]);

  const todayConfirmedCount = useMemo(
    () =>
      appointments.filter(
        (a) => a.date === todayKey && a.status === 'confirmed'
      ).length,
    [appointments, todayKey]
  );

  // Open Create Appointment Modal
  const openCreateApptModal = () => {
    setEditingAppt(null);
    setSelectedExistingClientId('new');
    setFormClientName('');
    setFormClientPhone('');
    setFormClientEmail('');
    setFormServiceId(studioConfig.services[0]?.id || 'fibra_vidro');
    setFormDate(dateFilter || todayKey);
    setFormTime(studioConfig.workingHours[0] || '08:30');
    setFormPaymentMethod('Pix');
    setFormStatus('confirmed');
    setFormNotes('');
    setApptFormError(null);
    setApptModalOpen(true);
  };

  // Open Edit Appointment Modal
  const openEditApptModal = (appt: Appointment) => {
    setEditingAppt(appt);
    setSelectedExistingClientId(appt.clientId);
    setFormClientName(appt.clientName);
    setFormClientPhone(appt.clientPhone);
    setFormClientEmail(appt.clientEmail);
    setFormServiceId(appt.serviceId);
    setFormDate(appt.date);
    setFormTime(appt.time);
    setFormPaymentMethod(appt.paymentMethod);
    setFormStatus(appt.status);
    setFormNotes(appt.notes || '');
    setApptFormError(null);
    setApptModalOpen(true);
  };

  const handleSelectExistingClient = (cid: string) => {
    setSelectedExistingClientId(cid);
    if (cid === 'new') {
      setFormClientName('');
      setFormClientPhone('');
      setFormClientEmail('');
      return;
    }
    const found = clients.find((c) => c.uid === cid);
    if (found) {
      setFormClientName(found.name);
      setFormClientPhone(found.phone);
      setFormClientEmail(found.email);
    }
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setApptFormError(null);

    if (formClientName.trim().length < 2) {
      setApptFormError('Informe o nome completo da cliente.');
      return;
    }
    if (formClientPhone.replace(/\D/g, '').length < 8) {
      setApptFormError('Informe um telefone válido.');
      return;
    }

    const service =
      studioConfig.services.find((s) => s.id === formServiceId) ||
      studioConfig.services[0];
    const newSlotId = makeSlotId(formDate, formTime);

    // Check slot collision with another confirmed appointment
    const conflictingSlot = slots.find(
      (s) =>
        s.id === newSlotId &&
        (!editingAppt || s.appointmentId !== editingAppt.id)
    );
    if (formStatus === 'confirmed' && conflictingSlot) {
      setApptFormError('Este horário já está ocupado por outra cliente.');
      return;
    }

    setApptSaving(true);
    if (useServerFallback) {
      try {
        let clientId = editingAppt
          ? editingAppt.clientId
          : selectedExistingClientId;
        if (!editingAppt && clientId === 'new') {
          clientId = `manual_${Date.now()}`;
        }
        const serverPayload = {
          clientId,
          clientName: formClientName.trim().slice(0, 100),
          clientPhone: formClientPhone.trim().slice(0, 25),
          clientEmail: formClientEmail.trim().slice(0, 120),
          serviceId: service.id,
          serviceName: service.name,
          servicePrice: service.price,
          date: formDate,
          time: formTime,
          slotId: newSlotId,
          status: formStatus,
          paymentMethod: formPaymentMethod,
          paymentTimingNote: 'Pagamento realizado presencialmente após o atendimento.',
          paymentStatus:
            formStatus === 'completed'
              ? ('paid' as const)
              : editingAppt?.paymentStatus || ('pending' as const),
          cancellationType:
            formStatus === 'cancelled'
              ? editingAppt?.cancellationType === 'late_fee'
                ? ('late_fee' as const)
                : ('free' as const)
              : ('none' as const),
          cancellationFee:
            formStatus === 'cancelled' ? editingAppt?.cancellationFee || 0 : 0,
          notes: formNotes.trim().slice(0, 500),
        };
        if (editingAppt) {
          await apiRequest(`/api/studio/bookings/${editingAppt.id}`, {
            method: 'PUT',
            body: JSON.stringify(serverPayload),
          });
        } else {
          await apiRequest('/api/studio/bookings', {
            method: 'POST',
            body: JSON.stringify(serverPayload),
          });
        }
        await onServerRefresh?.();
        setApptModalOpen(false);
      } catch (err) {
        setApptFormError(
          err instanceof Error ? err.message : 'Erro ao salvar agendamento.'
        );
      } finally {
        setApptSaving(false);
      }
      return;
    }

    try {
      const batch = writeBatch(db);
      let clientId = editingAppt
        ? editingAppt.clientId
        : selectedExistingClientId;

      if (!editingAppt && clientId === 'new') {
        clientId = `manual_${Date.now()}`;
        batch.set(doc(db, 'clients', clientId), {
          uid: clientId,
          name: formClientName.trim().slice(0, 100),
          phone: formClientPhone.trim().slice(0, 25),
          email: formClientEmail.trim().slice(0, 120),
          wallpaper: 'default',
          wallpaperOpacity: 0.28,
          notes: 'Cadastrada pela proprietária',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const apptRef = editingAppt
        ? doc(db, 'appointments', editingAppt.id)
        : doc(collection(db, 'appointments'));

      const payload = {
        clientId,
        clientName: formClientName.trim().slice(0, 100),
        clientPhone: formClientPhone.trim().slice(0, 25),
        clientEmail: formClientEmail.trim().slice(0, 120),
        serviceId: service.id,
        serviceName: service.name,
        servicePrice: service.price,
        date: formDate,
        time: formTime,
        slotId: newSlotId,
        status: formStatus,
        paymentMethod: formPaymentMethod,
        paymentTimingNote: 'Pagamento realizado presencialmente após o atendimento.',
        paymentStatus:
          formStatus === 'completed'
            ? ('paid' as const)
            : editingAppt?.paymentStatus || ('pending' as const),
        cancellationType:
          formStatus === 'cancelled'
            ? editingAppt?.cancellationType === 'late_fee'
              ? ('late_fee' as const)
              : ('free' as const)
            : ('none' as const),
        cancellationFee:
          formStatus === 'cancelled' ? editingAppt?.cancellationFee || 0 : 0,
        notes: formNotes.trim().slice(0, 500),
        createdAt: editingAppt ? editingAppt.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (editingAppt) {
        // Release old slot/lock if date/time changed or status became non-confirmed
        if (editingAppt.slotId !== newSlotId || formStatus !== 'confirmed') {
          batch.delete(doc(db, 'slots', editingAppt.slotId));
          batch.delete(
            doc(db, 'clientDayLocks', `${editingAppt.clientId}_${editingAppt.date}`)
          );
        }
        batch.update(apptRef, payload);
      } else {
        batch.set(apptRef, payload);
      }

      if (formStatus === 'confirmed') {
        batch.set(doc(db, 'slots', newSlotId), {
          date: formDate,
          time: formTime,
          status: 'booked',
          bookedByUid: clientId,
          appointmentId: apptRef.id,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'clientDayLocks', `${clientId}_${formDate}`), {
          clientId,
          date: formDate,
          appointmentId: apptRef.id,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setApptModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'appointments');
    } finally {
      setApptSaving(false);
    }
  };

  const handleCompleteAndPay = async (appt: Appointment) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/bookings/${appt.id}/complete`, {
        method: 'POST',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'appointments', appt.id), {
        status: 'completed',
        paymentStatus: 'paid',
        updatedAt: serverTimestamp(),
      });
      batch.delete(doc(db, 'slots', appt.slotId));
      batch.delete(doc(db, 'clientDayLocks', `${appt.clientId}_${appt.date}`));

      const finRef = doc(collection(db, 'finances'));
      batch.set(finRef, {
        date: appt.date,
        amount: appt.servicePrice,
        paymentMethod: appt.paymentMethod,
        description: `${appt.serviceName}`,
        clientName: appt.clientName,
        appointmentId: appt.id,
        type: 'income',
        createdBy: ownerUid,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `appointments/${appt.id}`);
    }
  };

  const handleConfirmFeePaid = async (appt: Appointment) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/bookings/${appt.id}/confirm-fee`, {
        method: 'POST',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'appointments', appt.id), {
        paymentStatus: 'paid',
        updatedAt: serverTimestamp(),
      });
      if (appt.cancellationFee > 0) {
        const finRef = doc(collection(db, 'finances'));
        batch.set(finRef, {
          date: appt.date,
          amount: appt.cancellationFee,
          paymentMethod: 'Pix',
          description: `Taxa de cancelamento (${appt.serviceName})`,
          clientName: appt.clientName,
          appointmentId: appt.id,
          type: 'fee',
          createdBy: ownerUid,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `appointments/${appt.id}`);
    }
  };

  const handleDeleteAppointment = async (appt: Appointment) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/bookings/${appt.id}`, {
        method: 'DELETE',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'appointments', appt.id));
      batch.delete(doc(db, 'slots', appt.slotId));
      batch.delete(doc(db, 'clientDayLocks', `${appt.clientId}_${appt.date}`));
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `appointments/${appt.id}`);
    }
  };

  // WhatsApp Ready-Made Templates
  const openWhatsAppModal = (appt: Appointment) => {
    setWaModalAppt(appt);
    setWaCustomMessage(
      `Olá ${appt.clientName}! Aqui é a Anne Caroline. Passando para lembrar que seu horário está chegando: ${formatShortDatePtBr(appt.date)} às ${appt.time} para ${appt.serviceName}. Te espero no estúdio!`
    );
  };

  const applyWaTemplate = (template: 'reminder' | 'unexpected' | 'chat') => {
    if (!waModalAppt) return;
    if (template === 'reminder') {
      setWaCustomMessage(
        `Olá ${waModalAppt.clientName}! Aqui é a Anne Caroline. Passando para lembrar que seu horário está chegando: ${formatShortDatePtBr(waModalAppt.date)} às ${waModalAppt.time} para ${waModalAppt.serviceName}. Te espero no estúdio!`
      );
    } else if (template === 'unexpected') {
      setWaCustomMessage(
        `Olá ${waModalAppt.clientName}, aqui é a Anne Caroline. Tive um imprevisto hoje e preciso avisar sobre seu horário de ${formatShortDatePtBr(waModalAppt.date)} às ${waModalAppt.time}. Podemos conversar para ajustar?`
      );
    } else {
      setWaCustomMessage(
        `Olá ${waModalAppt.clientName}, tudo bem? Aqui é a Anne Caroline do Atelier. Gostaria de conversar com você sobre seu atendimento.`
      );
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Client Directory Actions
  const openClientModal = (client: ClientProfile | null) => {
    setEditingClient(client);
    setCName(client?.name || '');
    setCPhone(client?.phone || '');
    setCEmail(client?.email || '');
    setCNotes(client?.notes || '');
    setClientModalOpen(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCSaving(true);
    if (useServerFallback) {
      try {
        await apiRequest('/api/studio/clients', {
          method: 'POST',
          body: JSON.stringify({
            uid: editingClient?.uid,
            name: cName.trim().slice(0, 100),
            phone: cPhone.trim().slice(0, 25),
            email: cEmail.trim().slice(0, 120),
            notes: cNotes.trim().slice(0, 500),
          }),
        });
        await onServerRefresh?.();
        setClientModalOpen(false);
      } finally {
        setCSaving(false);
      }
      return;
    }

    try {
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.uid), {
          name: cName.trim().slice(0, 100),
          phone: cPhone.trim().slice(0, 25),
          email: cEmail.trim().slice(0, 120),
          notes: cNotes.trim().slice(0, 500),
          updatedAt: serverTimestamp(),
        });
      } else {
        const newUid = `manual_${Date.now()}`;
        await setDoc(doc(db, 'clients', newUid), {
          uid: newUid,
          name: cName.trim().slice(0, 100),
          phone: cPhone.trim().slice(0, 25),
          email: cEmail.trim().slice(0, 120),
          wallpaper: 'default',
          wallpaperOpacity: 0.28,
          notes: cNotes.trim().slice(0, 500),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setClientModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'clients');
    } finally {
      setCSaving(false);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/clients/${clientId}`, {
        method: 'DELETE',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      await deleteDoc(doc(db, 'clients', clientId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `clients/${clientId}`);
    }
  };

  // Closure Actions
  const handleAddClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closureReason.trim()) return;
    setClosureSaving(true);
    if (useServerFallback) {
      try {
        await apiRequest('/api/studio/closures', {
          method: 'POST',
          body: JSON.stringify({
            type: closureType,
            date: closureDate,
            time: closureTime,
            reason: closureReason.trim().slice(0, 200),
          }),
        });
        await onServerRefresh?.();
        setClosureReason('');
      } finally {
        setClosureSaving(false);
      }
      return;
    }

    try {
      const batch = writeBatch(db);
      if (closureType === 'day') {
        batch.set(doc(db, 'closures', `day_${closureDate}`), {
          type: 'day',
          date: closureDate,
          endDate: closureDate,
          time: '',
          reason: closureReason.trim().slice(0, 200),
          createdBy: ownerUid,
          createdAt: serverTimestamp(),
        });
      } else if (closureType === 'week') {
        const weekDates = getWeekDatesFrom(closureDate);
        const endDate = weekDates[weekDates.length - 1];
        batch.set(doc(db, 'closures', `week_${closureDate}`), {
          type: 'week',
          date: closureDate,
          endDate,
          time: '',
          reason: closureReason.trim().slice(0, 200),
          createdBy: ownerUid,
          createdAt: serverTimestamp(),
        });
        weekDates.forEach((d) => {
          batch.set(doc(db, 'closures', `day_${d}`), {
            type: 'day',
            date: d,
            endDate: d,
            time: '',
            reason: `Semana fechada: ${closureReason.trim()}`.slice(0, 200),
            createdBy: ownerUid,
            createdAt: serverTimestamp(),
          });
        });
      } else {
        const sId = makeSlotId(closureDate, closureTime);
        batch.set(doc(db, 'closures', `slot_${sId}`), {
          type: 'slot',
          date: closureDate,
          endDate: closureDate,
          time: closureTime,
          reason: closureReason.trim().slice(0, 200),
          createdBy: ownerUid,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setClosureReason('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'closures');
    } finally {
      setClosureSaving(false);
    }
  };

  const handleRemoveClosure = async (closure: ClosureDoc) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/closures/${closure.id}`, {
        method: 'DELETE',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'closures', closure.id));
      if (closure.type === 'week') {
        const weekDates = getWeekDatesFrom(closure.date);
        weekDates.forEach((d) => {
          batch.delete(doc(db, 'closures', `day_${d}`));
        });
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `closures/${closure.id}`);
    }
  };

  // Finance Actions
  const handleAddFinance = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(finAmount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) return;

    setFinSaving(true);
    if (useServerFallback) {
      try {
        await apiRequest('/api/studio/finances', {
          method: 'POST',
          body: JSON.stringify({
            date: finDate,
            amount: numericAmount,
            paymentMethod: finMethod,
            description: finDesc.trim().slice(0, 200) || 'Atendimento no estúdio',
            clientName: finClientName.trim().slice(0, 100),
            type: finType,
          }),
        });
        await onServerRefresh?.();
        setFinAmount('');
        setFinClientName('');
        setFinDesc('');
      } finally {
        setFinSaving(false);
      }
      return;
    }

    try {
      const finRef = doc(collection(db, 'finances'));
      await setDoc(finRef, {
        date: finDate,
        amount: numericAmount,
        paymentMethod: finMethod,
        description: finDesc.trim().slice(0, 200) || 'Atendimento no estúdio',
        clientName: finClientName.trim().slice(0, 100),
        appointmentId: '',
        type: finType,
        createdBy: ownerUid,
        createdAt: serverTimestamp(),
      });
      setFinAmount('');
      setFinClientName('');
      setFinDesc('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'finances');
    } finally {
      setFinSaving(false);
    }
  };

  const handleDeleteFinance = async (id: string) => {
    if (useServerFallback) {
      await apiRequest(`/api/studio/finances/${id}`, {
        method: 'DELETE',
      });
      await onServerRefresh?.();
      return;
    }
    try {
      await deleteDoc(doc(db, 'finances', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `finances/${id}`);
    }
  };

  // Studio Config Save
  const handleSaveStudioConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setCfgSaving(true);
    setCfgSavedBanner(false);

    const parsedHours = cfgHoursText
      .split(',')
      .map((h) => h.trim())
      .filter((h) => /^\d{2}:\d{2}$/.test(h))
      .slice(0, 24);

    const cleanHours =
      parsedHours.length > 0 ? parsedHours : studioConfig.workingHours;

    const nextConfig = {
      studioName: cfgName.trim().slice(0, 100) || 'Atelier Anne Caroline',
      address: cfgAddress.trim().slice(0, 300),
      referencePoint: cfgRef.trim().slice(0, 200),
      mapsUrl:
        cfgMaps.trim().slice(0, 500) ||
        `https://maps.google.com/?q=${encodeURIComponent(cfgAddress.trim())}`,
      ownerPhone: cfgPhone.trim().slice(0, 25),
      ownerEmail: cfgEmail.trim().slice(0, 120),
      instagramUrl: cfgInstagram.trim().slice(0, 300),
      lateCancellationFee: Math.max(0, Number(cfgLateFee) || 0),
      pixKey: cfgPixKey.trim().slice(0, 140),
      pixBeneficiaryName: cfgPixBeneficiaryName.trim().slice(0, 60) || 'Anne Caroline',
      pixCity: cfgPixCity.trim().slice(0, 40) || 'SAO PAULO',
      workingHours: cleanHours,
      services: cfgServices.length > 0 ? cfgServices : studioConfig.services,
    };

    if (useServerFallback) {
      try {
        await apiRequest('/api/studio/config', {
          method: 'PUT',
          body: JSON.stringify(nextConfig),
        });
        await onServerRefresh?.();
        setCfgSavedBanner(true);
      } finally {
        setCfgSaving(false);
      }
      return;
    }

    try {
      await setDoc(doc(db, 'studio', 'config'), {
        ...nextConfig,
        updatedAt: serverTimestamp(),
      });
      setCfgSavedBanner(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'studio/config');
    } finally {
      setCfgSaving(false);
    }
  };

  const handleAddServiceRow = () => {
    setCfgServices((prev) => [
      ...prev,
      {
        id: `srv_${Date.now()}`,
        name: 'Novo Procedimento',
        durationMin: 60,
        price: 100,
      },
    ]);
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#16141C] flex flex-col">
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E4E2E8]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-6">
          <span className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#16141C] whitespace-nowrap shrink-0">
            {studioConfig.studioName}
          </span>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#5E5B66]">
            {(
              [
                ['agenda', 'Agenda Geral'],
                ['clients', 'Clientes'],
                ['closures', 'Bloqueios'],
                ['finance', 'Financeiro'],
                ['location', 'Salão & Pix'],
              ] as [OwnerTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === id
                    ? 'border-[#7A2E4D] text-[#16141C]'
                    : 'border-transparent hover:text-[#16141C]'
                }`}
              >
                {label}
              </button>
            ))}
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

        {/* Mobile/Tablet Sub-Navigation */}
        <div className="lg:hidden border-t border-[#E4E2E8] px-3 py-2 flex items-center gap-1 overflow-x-auto bg-white">
          {(
            [
              ['agenda', 'Agenda Geral'],
              ['clients', 'Clientes'],
              ['closures', 'Bloqueios'],
              ['finance', 'Financeiro'],
              ['location', 'Salão & Pix'],
            ] as [OwnerTab, string][]
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Owner Header Strip + KPIs */}
        <div className="bg-white border border-[#E4E2E8] rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={STUDIO_IMAGES.ownerAvatar}
              alt="Anne Caroline"
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-full object-cover border border-[#E4E2E8] shrink-0"
            />
            <div>
              <p className="text-xs text-[#5E5B66]">
                Painel da Proprietária · AnneCaroline
              </p>
              <h1 className="font-display text-3xl font-semibold text-[#16141C]">
                Gestão do Estúdio
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-[#E4E2E8]">
            <div>
              <p className="text-xs text-[#5E5B66]">Hoje confirmados</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-[#16141C] mt-0.5">
                {todayConfirmedCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#5E5B66]">Clientes salvas</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-[#16141C] mt-0.5">
                {clients.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#5E5B66]">Entradas hoje</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                {formatCurrencyBRL(financeMetrics.todayTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#5E5B66]">Entradas no mês</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-[#7A2E4D] mt-0.5">
                {formatCurrencyBRL(financeMetrics.monthTotal)}
              </p>
            </div>
          </div>
        </div>

        {/* TAB 1: AGENDA GERAL */}
        {activeTab === 'agenda' && (
          <section className="bg-white border border-[#E4E2E8] rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                  Agenda de Atendimentos
                </h2>
                <p className="text-xs text-[#5E5B66]">
                  Altere clientes e horários, cadastre atendimentos presenciais e envie avisos prontos no WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateApptModal}
                className="px-4 py-2.5 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Cadastrar Horário e Cliente</span>
              </button>
            </div>

            {/* Filters Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-[#E4E2E8]">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-[#5E5B66] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar cliente ou serviço..."
                    className="pl-9 pr-3 py-2 text-xs border border-[#E4E2E8] rounded-xl focus:outline-none focus:border-[#7A2E4D]"
                  />
                </div>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-2 text-xs font-mono tabular-nums border border-[#E4E2E8] rounded-xl focus:outline-none focus:border-[#7A2E4D]"
                />
                {dateFilter && (
                  <button
                    type="button"
                    onClick={() => setDateFilter('')}
                    className="text-xs text-[#7A2E4D] font-medium hover:underline"
                  >
                    Limpar data
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 p-1 bg-[#F3F2F5] rounded-xl">
                {(
                  [
                    ['all', 'Todos'],
                    ['confirmed', 'Confirmados'],
                    ['completed', 'Concluídos'],
                    ['cancelled', 'Cancelados'],
                  ] as ['all' | AppointmentStatus, string][]
                ).map(([st, label]) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === st
                        ? 'bg-white text-[#16141C] shadow-xs'
                        : 'text-[#5E5B66] hover:text-[#16141C]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Appointments List */}
            {filteredAppointments.length === 0 ? (
              <div className="py-12 text-center text-sm text-[#5E5B66]">
                Nenhum agendamento encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="divide-y divide-[#E4E2E8]">
                {filteredAppointments.map((appt) => (
                  <div
                    key={appt.id}
                    className="py-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#5E5B66]">
                        <span className="font-mono tabular-nums font-semibold text-[#16141C]">
                          {formatShortDatePtBr(appt.date)} · {appt.time}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            appt.status === 'confirmed'
                              ? 'text-[#7A2E4D]'
                              : appt.status === 'completed'
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {appt.status === 'confirmed'
                            ? 'Confirmado'
                            : appt.status === 'completed'
                            ? 'Concluído e Pago'
                            : appt.cancellationType === 'late_fee'
                            ? `Cancelado c/ taxa (${formatCurrencyBRL(appt.cancellationFee)}${appt.paymentStatus === 'paid' ? ' · Taxa paga' : ' · Pendente'})`
                            : 'Cancelado'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {appt.paymentMethod} · {formatCurrencyBRL(appt.servicePrice)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-base font-semibold text-[#16141C]">
                          {appt.clientName}
                        </h3>
                        <span className="text-xs text-[#5E5B66] font-mono tabular-nums">
                          {appt.clientPhone}
                        </span>
                        {appt.clientEmail && (
                          <span className="text-xs text-[#5E5B66]">
                            · {appt.clientEmail}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-[#5E5B66]">
                        {appt.serviceName}
                        {appt.notes ? ` · Obs: ${appt.notes}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openWhatsAppModal(appt)}
                        className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Mensagem Pronta</span>
                      </button>

                      {appt.status === 'confirmed' && (
                        <button
                          type="button"
                          onClick={() => handleCompleteAndPay(appt)}
                          className="px-3 py-2 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Concluir e Receber</span>
                        </button>
                      )}

                      {appt.status === 'cancelled' &&
                        appt.cancellationType === 'late_fee' &&
                        appt.cancellationFee > 0 &&
                        appt.paymentStatus === 'fee_pending' && (
                          <button
                            type="button"
                            onClick={() => handleConfirmFeePaid(appt)}
                            className="px-3 py-2 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Confirmar Taxa Paga</span>
                          </button>
                        )}

                      <button
                        type="button"
                        onClick={() => openEditApptModal(appt)}
                        className="px-3 py-2 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-[#16141C] text-xs font-medium rounded-xl inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Alterar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteAppointment(appt)}
                        aria-label="Excluir agendamento"
                        className="p-2 border border-[#E4E2E8] hover:bg-red-50 hover:border-red-200 text-[#5E5B66] hover:text-red-700 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: CLIENTES CADASTRADAS */}
        {activeTab === 'clients' && (
          <section className="bg-white border border-[#E4E2E8] rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E2E8] pb-4">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                  Clientes Cadastradas ({clients.length})
                </h2>
                <p className="text-xs text-[#5E5B66]">
                  Todas as clientes registradas no app ou cadastradas manualmente ficam salvas no Firebase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openClientModal(null)}
                className="px-4 py-2.5 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Cadastrar Cliente</span>
              </button>
            </div>

            {clients.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#5E5B66]">
                Nenhuma cliente cadastrada ainda.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E4E2E8] text-xs text-[#5E5B66]">
                      <th className="py-3 pr-4 font-semibold">Nome</th>
                      <th className="py-3 pr-4 font-semibold">Telefone / WhatsApp</th>
                      <th className="py-3 pr-4 font-semibold">E-mail</th>
                      <th className="py-3 pr-4 font-semibold">Observações</th>
                      <th className="py-3 text-right font-semibold">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E2E8]">
                    {clients.map((c) => (
                      <tr key={c.uid} className="hover:bg-[#FAFAFA]">
                        <td className="py-3.5 pr-4 font-semibold text-[#16141C]">
                          {c.name}
                        </td>
                        <td className="py-3.5 pr-4 font-mono tabular-nums text-xs">
                          {c.phone}
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-[#5E5B66]">
                          {c.email || '—'}
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-[#5E5B66] max-w-xs truncate">
                          {c.notes || '—'}
                        </td>
                        <td className="py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <a
                              href={buildWhatsAppUrl(
                                c.phone,
                                `Olá ${c.name}, tudo bem? Aqui é a Anne Caroline do Atelier!`
                              )}
                              target={WHATSAPP_TAB_TARGET}
                              className="px-2.5 py-1.5 border border-[#E4E2E8] hover:bg-emerald-50 text-emerald-800 text-xs font-medium rounded-lg inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>WhatsApp</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => openClientModal(c)}
                              className="px-2.5 py-1.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-xs font-medium rounded-lg"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(c.uid)}
                              aria-label="Excluir cliente"
                              className="p-1.5 border border-[#E4E2E8] hover:bg-red-50 text-[#5E5B66] hover:text-red-700 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 3: BLOQUEIOS DE AGENDA (DIA, SEMANA OU HORÁRIO) */}
        {activeTab === 'closures' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-5 bg-white border border-[#E4E2E8] rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                  Fechar Agenda
                </h2>
                <p className="text-xs text-[#5E5B66] mt-0.5">
                  Bloqueie um horário específico, um dia inteiro ou uma semana completa. As clientes verão o aviso e não poderão agendar nessas datas.
                </p>
              </div>

              <form onSubmit={handleAddClosure} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                    Tipo de bloqueio
                  </label>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-[#F3F2F5] rounded-xl">
                    {(
                      [
                        ['day', 'Dia inteiro'],
                        ['week', 'Semana (7 dias)'],
                        ['slot', 'Horário único'],
                      ] as ['day' | 'week' | 'slot', string][]
                    ).map(([t, label]) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setClosureType(t)}
                        className={`py-2 px-2 text-xs font-medium rounded-lg transition-colors ${
                          closureType === t
                            ? 'bg-white text-[#16141C] shadow-xs'
                            : 'text-[#5E5B66]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      {closureType === 'week' ? 'Data de início da semana' : 'Data'}
                    </label>
                    <input
                      type="date"
                      required
                      value={closureDate}
                      onChange={(e) => setClosureDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                    />
                  </div>

                  {closureType === 'slot' && (
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Horário
                      </label>
                      <select
                        value={closureTime}
                        onChange={(e) => setClosureTime(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl bg-white"
                      >
                        {studioConfig.workingHours.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Motivo visível na agenda
                  </label>
                  <input
                    type="text"
                    required
                    value={closureReason}
                    onChange={(e) => setClosureReason(e.target.value)}
                    placeholder="Ex: Feriado, Curso de aperfeiçoamento, Folga..."
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>

                <button
                  type="submit"
                  disabled={closureSaving}
                  className="w-full py-2.5 px-4 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  <span>{closureSaving ? 'Fechando...' : 'Fechar Agenda'}</span>
                </button>
              </form>
            </section>

            <section className="lg:col-span-7 bg-white border border-[#E4E2E8] rounded-2xl p-6 space-y-4">
              <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                Bloqueios Ativos ({closures.length})
              </h3>

              {closures.length === 0 ? (
                <p className="text-sm text-[#5E5B66] py-8 text-center">
                  Nenhum dia, semana ou horário fechado no momento.
                </p>
              ) : (
                <div className="divide-y divide-[#E4E2E8]">
                  {closures
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((cl) => (
                      <div
                        key={cl.id}
                        className="py-3.5 flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-xs text-[#5E5B66]">
                            <span className="font-semibold text-red-700">
                              {cl.type === 'week'
                                ? 'Semana fechada'
                                : cl.type === 'day'
                                ? 'Dia fechado'
                                : 'Horário fechado'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums font-semibold text-[#16141C]">
                              {formatShortDatePtBr(cl.date)}
                              {cl.type === 'week'
                                ? ` até ${formatShortDatePtBr(cl.endDate)}`
                                : cl.type === 'slot'
                                ? ` às ${cl.time}`
                                : ''}
                            </span>
                          </div>
                          <p className="text-sm text-[#16141C] mt-0.5">
                            {cl.reason}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveClosure(cl)}
                          className="px-3 py-1.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Reabrir</span>
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: RELATÓRIO FINANCEIRO */}
        {activeTab === 'finance' && (
          <div className="space-y-6">
            {/* Summary Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-[#E4E2E8] rounded-2xl p-5">
                <p className="text-xs text-[#5E5B66]">Entradas Hoje</p>
                <p className="text-2xl font-semibold font-mono tabular-nums text-[#16141C] mt-1">
                  {formatCurrencyBRL(financeMetrics.todayTotal)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E2E8] rounded-2xl p-5">
                <p className="text-xs text-[#5E5B66]">Últimos 7 Dias</p>
                <p className="text-2xl font-semibold font-mono tabular-nums text-[#16141C] mt-1">
                  {formatCurrencyBRL(financeMetrics.weekTotal)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E2E8] rounded-2xl p-5">
                <p className="text-xs text-[#5E5B66]">Total do Mês</p>
                <p className="text-2xl font-semibold font-mono tabular-nums text-[#7A2E4D] mt-1">
                  {formatCurrencyBRL(financeMetrics.monthTotal)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E2E8] rounded-2xl p-5">
                <p className="text-xs text-[#5E5B66]">Total Geral Registrado</p>
                <p className="text-2xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
                  {formatCurrencyBRL(financeMetrics.allTotal)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Add Daily Value Form */}
              <section className="lg:col-span-5 bg-white border border-[#E4E2E8] rounded-2xl p-6 space-y-5">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                    Adicionar Valor Recebido
                  </h2>
                  <p className="text-xs text-[#5E5B66] mt-0.5">
                    Registre tudo o que entrou no dia por atendimento ou taxa de cancelamento.
                  </p>
                </div>

                <form onSubmit={handleAddFinance} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Data
                      </label>
                      <input
                        type="date"
                        required
                        value={finDate}
                        onChange={(e) => setFinDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Valor (R$)
                      </label>
                      <input
                        type="text"
                        required
                        value={finAmount}
                        onChange={(e) => setFinAmount(e.target.value)}
                        placeholder="150,00"
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Forma de Pagamento
                      </label>
                      <select
                        value={finMethod}
                        onChange={(e) =>
                          setFinMethod(e.target.value as PaymentMethod)
                        }
                        className="w-full px-3 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                      >
                        {PAYMENT_METHODS.map((pm) => (
                          <option key={pm} value={pm}>
                            {pm}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Tipo de Entrada
                      </label>
                      <select
                        value={finType}
                        onChange={(e) =>
                          setFinType(e.target.value as 'income' | 'fee')
                        }
                        className="w-full px-3 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                      >
                        <option value="income">Atendimento</option>
                        <option value="fee">Taxa de Cancelamento</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Cliente (opcional)
                    </label>
                    <input
                      type="text"
                      value={finClientName}
                      onChange={(e) => setFinClientName(e.target.value)}
                      placeholder="Nome da cliente"
                      className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Descrição do recebimento
                    </label>
                    <input
                      type="text"
                      required
                      value={finDesc}
                      onChange={(e) => setFinDesc(e.target.value)}
                      placeholder="Ex: Alongamento Fibra de Vidro"
                      className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={finSaving}
                    className="w-full py-2.5 px-4 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>{finSaving ? 'Salvando...' : 'Registrar Entrada'}</span>
                  </button>
                </form>

                {/* Breakdown by Method */}
                <div className="pt-4 border-t border-[#E4E2E8] space-y-2">
                  <p className="text-xs font-semibold text-[#16141C]">
                    Resumo por forma de pagamento
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {PAYMENT_METHODS.map((pm) => (
                      <div key={pm} className="flex items-center justify-between">
                        <span className="text-[#5E5B66]">{pm}</span>
                        <span className="font-mono tabular-nums font-semibold text-[#16141C]">
                          {formatCurrencyBRL(financeMetrics.byMethod[pm])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Finance Ledger */}
              <section className="lg:col-span-7 bg-white border border-[#E4E2E8] rounded-2xl p-6 space-y-4">
                <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                  Histórico de Entradas ({finances.length})
                </h3>

                {finances.length === 0 ? (
                  <p className="text-sm text-[#5E5B66] py-10 text-center">
                    Nenhuma entrada financeira lançada ainda.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#E4E2E8] text-xs text-[#5E5B66]">
                          <th className="py-2.5 pr-3 font-semibold">Data</th>
                          <th className="py-2.5 pr-3 font-semibold">Descrição / Cliente</th>
                          <th className="py-2.5 pr-3 font-semibold">Pagamento</th>
                          <th className="py-2.5 pr-3 text-right font-semibold">Valor</th>
                          <th className="py-2.5 text-right font-semibold">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E2E8]">
                        {[...finances]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((f) => (
                            <tr key={f.id}>
                              <td className="py-3 pr-3 font-mono tabular-nums text-xs">
                                {formatShortDatePtBr(f.date)}
                              </td>
                              <td className="py-3 pr-3">
                                <p className="font-medium text-[#16141C] text-xs sm:text-sm">
                                  {f.description}
                                </p>
                                {f.clientName && (
                                  <p className="text-xs text-[#5E5B66]">
                                    {f.clientName}
                                  </p>
                                )}
                              </td>
                              <td className="py-3 pr-3 text-xs text-[#5E5B66]">
                                {f.paymentMethod}
                              </td>
                              <td className="py-3 pr-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                                {formatCurrencyBRL(f.amount)}
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteFinance(f.id)}
                                  aria-label="Excluir lançamento"
                                  className="p-1.5 text-[#5E5B66] hover:text-red-700"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* TAB 5: LOCALIZAÇÃO & CONFIGURAÇÕES DO SALÃO */}
        {activeTab === 'location' && (
          <section className="bg-white border border-[#E4E2E8] rounded-2xl p-6 sm:p-8 max-w-4xl space-y-6">
            <div className="border-b border-[#E4E2E8] pb-4">
              <h2 className="font-display text-2xl font-semibold text-[#16141C]">
                Localização do Salão e Configurações
              </h2>
              <p className="text-xs text-[#5E5B66] mt-0.5">
                O endereço e link do mapa editados aqui aparecem automaticamente para as clientes ao agendar e na aba Localização.
              </p>
            </div>

            {cfgSavedBanner && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Localização e configurações salvas no sistema!</span>
              </div>
            )}

            <form onSubmit={handleSaveStudioConfig} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Nome do Salão / Estúdio
                  </label>
                  <input
                    type="text"
                    required
                    value={cfgName}
                    onChange={(e) => setCfgName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Taxa de cancelamento (&lt; 2 horas) em R$
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cfgLateFee}
                    onChange={(e) => setCfgLateFee(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                  />
                </div>
              </div>

              {/* Chave Pix para Taxa de Cancelamento */}
              <div className="p-4 rounded-2xl bg-[#FAFAFA] border border-[#E4E2E8] space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-[#E4E2E8] flex items-center justify-center shrink-0">
                    <QrCode className="w-4 h-4 text-[#7A2E4D]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#16141C]">
                      Chave Pix para Taxa de Cancelamento
                    </h3>
                    <p className="text-xs text-[#5E5B66] mt-0.5">
                      Quando uma cliente cancelar com menos de 2 horas e tiver que pagar a taxa, o app gera automaticamente um QR Code Pix e código Copia e Cola usando esta chave.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Chave Pix (CPF, CNPJ, e-mail, celular ou chave aleatória)
                    </label>
                    <input
                      type="text"
                      value={cfgPixKey}
                      onChange={(e) => setCfgPixKey(e.target.value)}
                      placeholder="Ex: 123.456.789-00, seuemail@pix.com ou +5511999999999"
                      className="w-full px-3.5 py-2 text-sm font-mono bg-white border border-[#E4E2E8] rounded-xl"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Nome do titular no Pix
                    </label>
                    <input
                      type="text"
                      value={cfgPixBeneficiaryName}
                      onChange={(e) => setCfgPixBeneficiaryName(e.target.value)}
                      placeholder="Anne Caroline"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-[#E4E2E8] rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Cidade do titular
                    </label>
                    <input
                      type="text"
                      value={cfgPixCity}
                      onChange={(e) => setCfgPixCity(e.target.value)}
                      placeholder="SAO PAULO"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-[#E4E2E8] rounded-xl"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Endereço completo do salão
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-[#7A2E4D] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={cfgAddress}
                      onChange={(e) => setCfgAddress(e.target.value)}
                      placeholder="Rua, número, complemento, bairro, cidade"
                      className="w-full pl-10 pr-4 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Ponto de referência
                  </label>
                  <input
                    type="text"
                    value={cfgRef}
                    onChange={(e) => setCfgRef(e.target.value)}
                    placeholder="Ex: Próximo ao mercado central, sala 04"
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-[#16141C]">
                      Link do Google Maps
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setCfgMaps(
                          `https://maps.google.com/?q=${encodeURIComponent(cfgAddress.trim())}`
                        )
                      }
                      className="text-xs font-medium text-[#7A2E4D] hover:underline"
                    >
                      Gerar link pelo endereço
                    </button>
                  </div>
                  <input
                    type="url"
                    value={cfgMaps}
                    onChange={(e) => setCfgMaps(e.target.value)}
                    placeholder="https://maps.google.com/?q=..."
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    WhatsApp do Salão
                  </label>
                  <input
                    type="text"
                    value={cfgPhone}
                    onChange={(e) => setCfgPhone(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    E-mail do Salão
                  </label>
                  <input
                    type="email"
                    value={cfgEmail}
                    onChange={(e) => setCfgEmail(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Instagram do Salão (@perfil ou link)
                  </label>
                  <div className="relative">
                    <Instagram className="w-4 h-4 text-[#7A2E4D] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={cfgInstagram}
                      onChange={(e) => setCfgInstagram(e.target.value)}
                      placeholder="@atelierannecaroline"
                      className="w-full pl-9 pr-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Horários padrão de atendimento (separados por vírgula, formato HH:MM)
                </label>
                <input
                  type="text"
                  value={cfgHoursText}
                  onChange={(e) => setCfgHoursText(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                />
              </div>

              {/* Services Editor */}
              <div className="space-y-3 pt-2 border-t border-[#E4E2E8]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#16141C]">
                    Serviços e Valores
                  </label>
                  <button
                    type="button"
                    onClick={handleAddServiceRow}
                    className="text-xs font-semibold text-[#7A2E4D] hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar serviço</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {cfgServices.map((srv, idx) => (
                    <div
                      key={srv.id}
                      className="grid grid-cols-12 gap-2 items-center"
                    >
                      <input
                        type="text"
                        value={srv.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCfgServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, name: val } : item
                            )
                          );
                        }}
                        className="col-span-6 px-3 py-1.5 text-xs border border-[#E4E2E8] rounded-lg"
                      />
                      <input
                        type="number"
                        min={15}
                        step={15}
                        value={srv.durationMin}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 60;
                          setCfgServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, durationMin: val } : item
                            )
                          );
                        }}
                        className="col-span-2 px-2 py-1.5 text-xs font-mono tabular-nums border border-[#E4E2E8] rounded-lg"
                        title="Duração em minutos"
                      />
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={srv.price}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setCfgServices((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, price: val } : item
                            )
                          );
                        }}
                        className="col-span-3 px-2 py-1.5 text-xs font-mono tabular-nums border border-[#E4E2E8] rounded-lg"
                        title="Valor em R$"
                      />
                      <button
                        type="button"
                        disabled={cfgServices.length <= 1}
                        onClick={() =>
                          setCfgServices((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="col-span-1 p-1.5 text-[#5E5B66] hover:text-red-700 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={cfgSaving}
                className="px-6 py-3 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                {cfgSaving ? 'Salvando alterações...' : 'Salvar Localização e Configurações'}
              </button>
            </form>
          </section>
        )}
      </main>

      {/* MODAL: CADASTRAR / EDITAR HORÁRIO E CLIENTE */}
      {apptModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                {editingAppt
                  ? 'Alterar Agendamento'
                  : 'Cadastrar Horário e Cliente'}
              </h3>
              <button
                type="button"
                onClick={() => setApptModalOpen(false)}
                className="p-1.5 text-[#5E5B66] hover:text-[#16141C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {apptFormError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                {apptFormError}
              </div>
            )}

            <form onSubmit={handleSaveAppointment} className="space-y-4">
              {!editingAppt && (
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Selecionar cliente cadastrada ou nova
                  </label>
                  <select
                    value={selectedExistingClientId}
                    onChange={(e) => handleSelectExistingClient(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                  >
                    <option value="new">+ Cadastrar nova cliente agora</option>
                    {clients.map((c) => (
                      <option key={c.uid} value={c.uid}>
                        {c.name} ({c.phone})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Nome completo da cliente
                </label>
                <input
                  type="text"
                  required
                  value={formClientName}
                  onChange={(e) => setFormClientName(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Telefone (WhatsApp)
                  </label>
                  <input
                    type="tel"
                    required
                    value={formClientPhone}
                    onChange={(e) => setFormClientPhone(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    E-mail
                  </label>
                  <input
                    type="email"
                    value={formClientEmail}
                    onChange={(e) => setFormClientEmail(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Horário
                  </label>
                  <select
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E4E2E8] rounded-xl bg-white"
                  >
                    {studioConfig.workingHours.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Procedimento
                  </label>
                  <select
                    value={formServiceId}
                    onChange={(e) => setFormServiceId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                  >
                    {studioConfig.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({formatCurrencyBRL(s.price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Forma de pagamento
                  </label>
                  <select
                    value={formPaymentMethod}
                    onChange={(e) =>
                      setFormPaymentMethod(e.target.value as PaymentMethod)
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editingAppt && (
                <div>
                  <label className="block text-xs font-semibold text-[#16141C] mb-1">
                    Status do agendamento
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as AppointmentStatus)
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E4E2E8] rounded-xl bg-white"
                  >
                    <option value="confirmed">Confirmado</option>
                    <option value="completed">Concluído</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setApptModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-[#5E5B66]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={apptSaving}
                  className="px-5 py-2.5 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl"
                >
                  {apptSaving ? 'Salvando...' : 'Salvar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MENSAGEM PRONTA WHATSAPP */}
      {waModalAppt && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                  Mensagem Pronta para WhatsApp
                </h3>
                <p className="text-xs text-[#5E5B66]">
                  Para {waModalAppt.clientName} · {waModalAppt.clientPhone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWaModalAppt(null)}
                className="p-1.5 text-[#5E5B66] hover:text-[#16141C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyWaTemplate('reminder')}
                className="py-2 px-3 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#16141C]"
              >
                Horário chegando
              </button>
              <button
                type="button"
                onClick={() => applyWaTemplate('unexpected')}
                className="py-2 px-3 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#16141C]"
              >
                Avisar imprevisto
              </button>
              <button
                type="button"
                onClick={() => applyWaTemplate('chat')}
                className="py-2 px-3 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#16141C]"
              >
                Chamar p/ conversa
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                Texto da mensagem (editável)
              </label>
              <textarea
                rows={4}
                value={waCustomMessage}
                onChange={(e) => setWaCustomMessage(e.target.value)}
                className="w-full p-3.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:border-[#7A2E4D]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleCopyText(waCustomMessage, waModalAppt.id)}
                className="px-4 py-2.5 border border-[#E4E2E8] hover:bg-[#F3F2F5] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5"
              >
                {copiedId === waModalAppt.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar texto</span>
                  </>
                )}
              </button>

              <a
                href={buildWhatsAppUrl(waModalAppt.clientPhone, waCustomMessage)}
                target={WHATSAPP_TAB_TARGET}
                className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Enviar no WhatsApp Agora</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CADASTRAR / EDITAR CLIENTE */}
      {clientModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl font-semibold text-[#16141C]">
                {editingClient ? 'Editar Cliente' : 'Cadastrar Nova Cliente'}
              </h3>
              <button
                type="button"
                onClick={() => setClientModalOpen(false)}
                className="p-1.5 text-[#5E5B66] hover:text-[#16141C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Nome completo
                </label>
                <input
                  type="text"
                  required
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Telefone (WhatsApp)
                </label>
                <input
                  type="tel"
                  required
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#16141C] mb-1">
                  Observações (preferências de formato, cor, etc.)
                </label>
                <input
                  type="text"
                  value={cNotes}
                  onChange={(e) => setCNotes(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-[#E4E2E8] rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setClientModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-[#5E5B66]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={cSaving}
                  className="px-5 py-2.5 bg-[#7A2E4D] hover:bg-[#61233C] text-white text-xs font-semibold rounded-xl"
                >
                  {cSaving ? 'Salvando...' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
