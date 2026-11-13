import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';

interface NailService {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

interface StudioConfig {
  studioName: string;
  address: string;
  referencePoint: string;
  mapsUrl: string;
  ownerPhone: string;
  ownerEmail: string;
  lateCancellationFee: number;
  pixKey?: string;
  pixBeneficiaryName?: string;
  pixCity?: string;
  workingHours: string[];
  services: NailService[];
  updatedAt?: string;
}

interface StoredAccount {
  uid: string;
  email: string;
  passwordHash: string;
  role: 'client' | 'owner';
}

interface ClientProfile {
  uid: string;
  name: string;
  phone: string;
  email: string;
  wallpaper: string;
  wallpaperOpacity: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  date: string;
  time: string;
  slotId: string;
  status: 'confirmed' | 'completed' | 'cancelled';
  paymentMethod: 'Pix' | 'Cartão de Crédito' | 'Cartão de Débito' | 'Dinheiro';
  paymentTimingNote: string;
  paymentStatus: 'pending' | 'paid' | 'fee_pending';
  cancellationType: 'none' | 'free' | 'late_fee';
  cancellationFee: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface SlotDoc {
  id: string;
  date: string;
  time: string;
  status: 'booked';
  bookedByUid: string;
  appointmentId: string;
  createdAt: string;
}

interface ClosureDoc {
  id: string;
  type: 'day' | 'week' | 'slot';
  date: string;
  endDate: string;
  time: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

interface FinanceEntry {
  id: string;
  date: string;
  amount: number;
  paymentMethod: 'Pix' | 'Cartão de Crédito' | 'Cartão de Débito' | 'Dinheiro';
  description: string;
  clientName: string;
  appointmentId: string;
  type: 'income' | 'fee';
  createdBy: string;
  createdAt: string;
}

interface StudioDatabase {
  accounts: StoredAccount[];
  clients: ClientProfile[];
  appointments: Appointment[];
  slots: SlotDoc[];
  clientDayLocks: { id: string; clientId: string; date: string; appointmentId: string }[];
  closures: ClosureDoc[];
  finances: FinanceEntry[];
  studioConfig: StudioConfig;
}

const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  studioName: 'Atelier Anne Caroline',
  address: 'Rua das Flores, 240 — Sala 04, Centro',
  referencePoint: 'Próximo à Praça Central, edifício com fachada de vidro',
  mapsUrl: 'https://maps.google.com/?q=Rua+das+Flores+240+Centro',
  ownerPhone: '5511999999999',
  ownerEmail: 'contato@atelierannecaroline.com',
  lateCancellationFee: 35,
  pixKey: '',
  pixBeneficiaryName: 'Anne Caroline',
  pixCity: 'SAO PAULO',
  workingHours: ['08:30', '10:00', '11:30', '13:30', '15:00', '16:30', '18:00'],
  services: [
    { id: 'fibra_vidro', name: 'Alongamento em Fibra de Vidro', durationMin: 120, price: 180 },
    { id: 'banho_gel', name: 'Banho de Gel Natural', durationMin: 90, price: 120 },
    { id: 'manutencao', name: 'Manutenção de Alongamento', durationMin: 90, price: 110 },
    { id: 'esmaltacao_gel', name: 'Esmaltação em Gel', durationMin: 60, price: 85 },
    { id: 'spa_pes', name: 'Spa dos Pés + Esmaltação', durationMin: 60, price: 95 },
  ],
};

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'studio-db.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'atelier-anne-caroline-session-key';

function loadDb(): StudioDatabase {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      const initial: StudioDatabase = {
        accounts: [],
        clients: [],
        appointments: [],
        slots: [],
        clientDayLocks: [],
        closures: [],
        finances: [],
        studioConfig: DEFAULT_STUDIO_CONFIG,
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw) as StudioDatabase;
  } catch {
    return {
      accounts: [],
      clients: [],
      appointments: [],
      slots: [],
      clientDayLocks: [],
      closures: [],
      finances: [],
      studioConfig: DEFAULT_STUDIO_CONFIG,
    };
  }
}

function saveDb(db: StudioDatabase) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function signToken(payload: { uid: string; role: 'client' | 'owner'; email: string; name: string }): string {
  const data = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): { uid: string; role: 'client' | 'owner'; email: string; name: string } | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function getAuthSession(req: express.Request) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.slice(7));
}

function getWeekDatesFrom(startDateStr: string): string[] {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    dates.push(`${yy}-${mm}-${dd}`);
  }
  return dates;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- Auth Endpoints (Fallback when Firebase Email/Password provider is disabled) ---
  app.post('/api/auth/register', (req, res) => {
    const { name, phone, email, password } = req.body as {
      name?: string;
      phone?: string;
      email?: string;
      password?: string;
    };
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();
    if (cleanName.length < 2 || cleanPhone.replace(/\D/g, '').length < 8 || !cleanEmail.includes('@') || (password || '').length < 6) {
      return res.status(400).json({ error: 'Dados inválidos para cadastro.' });
    }

    const db = loadDb();
    if (db.accounts.some((a) => a.email === cleanEmail)) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado. Acesse a aba Entrar.' });
    }

    const uid = `cli_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    db.accounts.push({
      uid,
      email: cleanEmail,
      passwordHash: hashPassword(password || ''),
      role: 'client',
    });
    db.clients.push({
      uid,
      name: cleanName.slice(0, 100),
      phone: cleanPhone.slice(0, 25),
      email: cleanEmail.slice(0, 120),
      wallpaper: 'default',
      wallpaperOpacity: 0.28,
      notes: '',
      createdAt: now,
      updatedAt: now,
    });
    saveDb(db);

    const token = signToken({ uid, role: 'client', email: cleanEmail, name: cleanName });
    return res.json({ token, user: { uid, role: 'client', email: cleanEmail, name: cleanName } });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    const db = loadDb();
    const acc = db.accounts.find((a) => a.email === cleanEmail && a.role === 'client');
    if (!acc || !verifyPassword(password || '', acc.passwordHash)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    const client = db.clients.find((c) => c.uid === acc.uid);
    const name = client?.name || 'Cliente';
    const token = signToken({ uid: acc.uid, role: 'client', email: cleanEmail, name });
    return res.json({ token, user: { uid: acc.uid, role: 'client', email: cleanEmail, name } });
  });

  app.post('/api/auth/admin-login', (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if ((username || '').trim() !== 'AnneCaroline' || password !== 'carol20') {
      return res.status(401).json({ error: 'Usuário ou senha de administrador inválidos.' });
    }
    const uid = 'owner_anne_caroline';
    const token = signToken({
      uid,
      role: 'owner',
      email: 'annecaroline@studioanne.app',
      name: 'Anne Caroline',
    });
    return res.json({
      token,
      user: {
        uid,
        role: 'owner',
        email: 'annecaroline@studioanne.app',
        name: 'Anne Caroline',
      },
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { email, newPassword } = req.body as { email?: string; newPassword?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    const db = loadDb();
    const acc = db.accounts.find((a) => a.email === cleanEmail && a.role === 'client');
    if (!acc) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada com este e-mail.' });
    }
    if (newPassword && newPassword.length >= 6) {
      acc.passwordHash = hashPassword(newPassword);
      saveDb(db);
      return res.json({ ok: true, resetCompleted: true });
    }
    return res.json({ ok: true, canResetDirectly: true });
  });

  // --- Studio State & Mutations ---
  app.get('/api/studio/state', (req, res) => {
    const session = getAuthSession(req);
    if (!session) return res.status(401).json({ error: 'Não autenticado.' });

    const db = loadDb();
    if (session.role === 'owner') {
      return res.json({
        studioConfig: db.studioConfig,
        clients: db.clients,
        appointments: db.appointments,
        slots: db.slots,
        closures: db.closures,
        finances: db.finances,
        clientProfile: null,
      });
    }

    const clientProfile = db.clients.find((c) => c.uid === session.uid) || null;
    const appointments = db.appointments.filter((a) => a.clientId === session.uid);
    return res.json({
      studioConfig: db.studioConfig,
      clients: [],
      appointments,
      slots: db.slots,
      closures: db.closures,
      finances: [],
      clientProfile,
    });
  });

  app.post('/api/studio/bookings', (req, res) => {
    const session = getAuthSession(req);
    if (!session) return res.status(401).json({ error: 'Não autenticado.' });

    const { timezoneOffsetMinutes, ...bookingFields } = req.body as Omit<
      Appointment,
      'id' | 'createdAt' | 'updatedAt'
    > & { timezoneOffsetMinutes?: number };
    const body = bookingFields;
    const db = loadDb();

    if (session.role !== 'owner') {
      const [yy, mm, dd] = (body.date || '').split('-').map(Number);
      const [hh, min] = (body.time || '').split(':').map(Number);
      if (yy && mm && dd && !Number.isNaN(hh) && !Number.isNaN(min)) {
        const slotEpochMs =
          typeof timezoneOffsetMinutes === 'number'
            ? Date.UTC(yy, mm - 1, dd, hh, min, 0, 0) +
              timezoneOffsetMinutes * 60_000
            : new Date(yy, mm - 1, dd, hh, min, 0, 0).getTime();
        if (slotEpochMs <= Date.now()) {
          return res.status(400).json({
            error: 'Este horário já passou hoje. Selecione um horário futuro disponível.',
          });
        }
      }

      const closedDay = db.closures.find(
        (c) =>
          (c.type === 'day' && c.date === body.date) ||
          (c.type === 'week' && body.date >= c.date && body.date <= c.endDate) ||
          (c.type === 'slot' && c.date === body.date && c.time === body.time)
      );
      if (closedDay) {
        return res.status(400).json({ error: `Agenda fechada (${closedDay.reason}).` });
      }
      if (db.clientDayLocks.some((l) => l.clientId === session.uid && l.date === body.date)) {
        return res.status(400).json({ error: 'Você já possui 1 horário reservado neste dia.' });
      }
      if (db.slots.some((s) => s.id === body.slotId)) {
        return res.status(409).json({ error: 'Este horário já está ocupado.' });
      }
    }

    const now = new Date().toISOString();
    const id = `appt_${crypto.randomBytes(8).toString('hex')}`;
    const clientId = session.role === 'owner' ? body.clientId : session.uid;

    if (session.role === 'owner' && body.clientId.startsWith('manual_') && !db.clients.some((c) => c.uid === body.clientId)) {
      db.clients.push({
        uid: body.clientId,
        name: body.clientName,
        phone: body.clientPhone,
        email: body.clientEmail || '',
        wallpaper: 'default',
        wallpaperOpacity: 0.28,
        notes: 'Cadastrada pela proprietária',
        createdAt: now,
        updatedAt: now,
      });
    }

    const newAppt: Appointment = {
      ...body,
      id,
      clientId,
      createdAt: now,
      updatedAt: now,
    };
    db.appointments.push(newAppt);

    if (newAppt.status === 'confirmed') {
      db.slots.push({
        id: newAppt.slotId,
        date: newAppt.date,
        time: newAppt.time,
        status: 'booked',
        bookedByUid: clientId,
        appointmentId: id,
        createdAt: now,
      });
      db.clientDayLocks.push({
        id: `${clientId}_${newAppt.date}`,
        clientId,
        date: newAppt.date,
        appointmentId: id,
      });
    }

    const existingClient = db.clients.find((c) => c.uid === clientId);
    if (existingClient) {
      existingClient.name = body.clientName;
      existingClient.phone = body.clientPhone;
      existingClient.email = body.clientEmail;
      existingClient.updatedAt = now;
    }

    saveDb(db);
    return res.json({ appointment: newAppt });
  });

  app.post('/api/studio/bookings/:id/cancel', (req, res) => {
    const session = getAuthSession(req);
    if (!session) return res.status(401).json({ error: 'Não autenticado.' });

    const { id } = req.params;
    const { cancellationType, cancellationFee, paymentStatus } = req.body as {
      cancellationType: 'free' | 'late_fee';
      cancellationFee: number;
      paymentStatus: 'pending' | 'fee_pending';
    };

    const db = loadDb();
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (session.role !== 'owner' && appt.clientId !== session.uid) {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    appt.status = 'cancelled';
    appt.cancellationType = cancellationType;
    appt.cancellationFee = cancellationFee;
    appt.paymentStatus = paymentStatus;
    appt.updatedAt = new Date().toISOString();

    db.slots = db.slots.filter((s) => s.id !== appt.slotId);
    db.clientDayLocks = db.clientDayLocks.filter(
      (l) => !(l.clientId === appt.clientId && l.date === appt.date)
    );
    saveDb(db);
    return res.json({ ok: true });
  });

  app.put('/api/studio/bookings/:id', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }

    const { id } = req.params;
    const body = req.body as Partial<Appointment>;
    const db = loadDb();
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    const oldSlotId = appt.slotId;
    const oldDate = appt.date;
    Object.assign(appt, body, { updatedAt: new Date().toISOString() });

    db.slots = db.slots.filter((s) => s.id !== oldSlotId);
    db.clientDayLocks = db.clientDayLocks.filter(
      (l) => !(l.clientId === appt.clientId && l.date === oldDate)
    );

    if (appt.status === 'confirmed') {
      db.slots.push({
        id: appt.slotId,
        date: appt.date,
        time: appt.time,
        status: 'booked',
        bookedByUid: appt.clientId,
        appointmentId: appt.id,
        createdAt: new Date().toISOString(),
      });
      db.clientDayLocks.push({
        id: `${appt.clientId}_${appt.date}`,
        clientId: appt.clientId,
        date: appt.date,
        appointmentId: appt.id,
      });
    }

    saveDb(db);
    return res.json({ ok: true });
  });

  app.post('/api/studio/bookings/:id/complete', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    const appt = db.appointments.find((a) => a.id === req.params.id);
    if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    const now = new Date().toISOString();
    appt.status = 'completed';
    appt.paymentStatus = 'paid';
    appt.updatedAt = now;
    db.slots = db.slots.filter((s) => s.id !== appt.slotId);
    db.clientDayLocks = db.clientDayLocks.filter(
      (l) => !(l.clientId === appt.clientId && l.date === appt.date)
    );
    db.finances.push({
      id: `fin_${crypto.randomBytes(8).toString('hex')}`,
      date: appt.date,
      amount: appt.servicePrice,
      paymentMethod: appt.paymentMethod,
      description: appt.serviceName,
      clientName: appt.clientName,
      appointmentId: appt.id,
      type: 'income',
      createdBy: session.uid,
      createdAt: now,
    });
    saveDb(db);
    return res.json({ ok: true });
  });

  app.post('/api/studio/bookings/:id/confirm-fee', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    const appt = db.appointments.find((a) => a.id === req.params.id);
    if (!appt) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    const now = new Date().toISOString();
    appt.paymentStatus = 'paid';
    appt.updatedAt = now;
    if (appt.cancellationFee > 0) {
      db.finances.push({
        id: `fin_${crypto.randomBytes(8).toString('hex')}`,
        date: appt.date,
        amount: appt.cancellationFee,
        paymentMethod: 'Pix',
        description: `Taxa de cancelamento (${appt.serviceName})`,
        clientName: appt.clientName,
        appointmentId: appt.id,
        type: 'fee',
        createdBy: session.uid,
        createdAt: now,
      });
    }
    saveDb(db);
    return res.json({ ok: true });
  });

  app.delete('/api/studio/bookings/:id', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    const appt = db.appointments.find((a) => a.id === req.params.id);
    if (appt) {
      db.appointments = db.appointments.filter((a) => a.id !== appt.id);
      db.slots = db.slots.filter((s) => s.id !== appt.slotId);
      db.clientDayLocks = db.clientDayLocks.filter(
        (l) => !(l.clientId === appt.clientId && l.date === appt.date)
      );
      saveDb(db);
    }
    return res.json({ ok: true });
  });

  app.put('/api/studio/clients/wallpaper', (req, res) => {
    const session = getAuthSession(req);
    if (!session) return res.status(401).json({ error: 'Não autenticado.' });
    const { wallpaper, wallpaperOpacity } = req.body as {
      wallpaper: string;
      wallpaperOpacity: number;
    };
    const db = loadDb();
    const client = db.clients.find((c) => c.uid === session.uid);
    if (client) {
      client.wallpaper = wallpaper;
      client.wallpaperOpacity = wallpaperOpacity;
      client.updatedAt = new Date().toISOString();
      saveDb(db);
    }
    return res.json({ ok: true });
  });

  app.post('/api/studio/clients', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const { uid, name, phone, email, notes } = req.body as {
      uid?: string;
      name: string;
      phone: string;
      email: string;
      notes?: string;
    };
    const db = loadDb();
    const now = new Date().toISOString();
    if (uid) {
      const existing = db.clients.find((c) => c.uid === uid);
      if (existing) {
        existing.name = name;
        existing.phone = phone;
        existing.email = email;
        existing.notes = notes || '';
        existing.updatedAt = now;
      }
    } else {
      db.clients.push({
        uid: `manual_${Date.now()}`,
        name,
        phone,
        email,
        wallpaper: 'default',
        wallpaperOpacity: 0.28,
        notes: notes || '',
        createdAt: now,
        updatedAt: now,
      });
    }
    saveDb(db);
    return res.json({ ok: true });
  });

  app.delete('/api/studio/clients/:uid', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    db.clients = db.clients.filter((c) => c.uid !== req.params.uid);
    saveDb(db);
    return res.json({ ok: true });
  });

  app.post('/api/studio/closures', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const { type, date, time, reason } = req.body as {
      type: 'day' | 'week' | 'slot';
      date: string;
      time: string;
      reason: string;
    };
    const db = loadDb();
    const now = new Date().toISOString();
    if (type === 'day') {
      db.closures = db.closures.filter((c) => c.id !== `day_${date}`);
      db.closures.push({ id: `day_${date}`, type: 'day', date, endDate: date, time: '', reason, createdBy: session.uid, createdAt: now });
    } else if (type === 'week') {
      const dates = getWeekDatesFrom(date);
      const endDate = dates[dates.length - 1];
      db.closures = db.closures.filter((c) => c.id !== `week_${date}`);
      db.closures.push({ id: `week_${date}`, type: 'week', date, endDate, time: '', reason, createdBy: session.uid, createdAt: now });
      dates.forEach((d) => {
        db.closures = db.closures.filter((c) => c.id !== `day_${d}`);
        db.closures.push({ id: `day_${d}`, type: 'day', date: d, endDate: d, time: '', reason: `Semana fechada: ${reason}`, createdBy: session.uid, createdAt: now });
      });
    } else {
      const sId = `${date}_${time.replace(':', '-')}`;
      db.closures = db.closures.filter((c) => c.id !== `slot_${sId}`);
      db.closures.push({ id: `slot_${sId}`, type: 'slot', date, endDate: date, time, reason, createdBy: session.uid, createdAt: now });
    }
    saveDb(db);
    return res.json({ ok: true });
  });

  app.delete('/api/studio/closures/:id', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    const target = db.closures.find((c) => c.id === req.params.id);
    if (target) {
      db.closures = db.closures.filter((c) => c.id !== target.id);
      if (target.type === 'week') {
        const weekDates = new Set(getWeekDatesFrom(target.date).map((d) => `day_${d}`));
        db.closures = db.closures.filter((c) => !weekDates.has(c.id));
      }
      saveDb(db);
    }
    return res.json({ ok: true });
  });

  app.post('/api/studio/finances', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const { date, amount, paymentMethod, description, clientName, type } = req.body as Omit<FinanceEntry, 'id' | 'appointmentId' | 'createdBy' | 'createdAt'>;
    const db = loadDb();
    db.finances.push({
      id: `fin_${crypto.randomBytes(8).toString('hex')}`,
      date,
      amount,
      paymentMethod,
      description,
      clientName: clientName || '',
      appointmentId: '',
      type,
      createdBy: session.uid,
      createdAt: new Date().toISOString(),
    });
    saveDb(db);
    return res.json({ ok: true });
  });

  app.delete('/api/studio/finances/:id', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    db.finances = db.finances.filter((f) => f.id !== req.params.id);
    saveDb(db);
    return res.json({ ok: true });
  });

  app.put('/api/studio/config', (req, res) => {
    const session = getAuthSession(req);
    if (!session || session.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas administrador.' });
    }
    const db = loadDb();
    db.studioConfig = {
      ...(req.body as StudioConfig),
      updatedAt: new Date().toISOString(),
    };
    saveDb(db);
    return res.json({ ok: true });
  });

  // --- Vite / Static Frontend ---
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Atelier Anne Caroline server running on http://0.0.0.0:3000');
  });
}

startServer();
