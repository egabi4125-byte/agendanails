import { Component, ErrorInfo, ReactNode, useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from './firebase';
import {
  apiRequest,
  clearStoredFallbackSession,
  FallbackSessionUser,
  getStoredFallbackSession,
} from './services/apiFallback';
import {
  Appointment,
  ClientProfile,
  ClosureDoc,
  DEFAULT_STUDIO_CONFIG,
  FinanceEntry,
  SlotDoc,
  StudioConfig,
} from './types';
import { AuthScreen } from './components/AuthScreen';
import { ClientPortal } from './components/ClientPortal';
import { OwnerPortal } from './components/OwnerPortal';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na aplicação:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] text-[#16141C] flex items-center justify-center p-6">
          <div className="bg-white border border-[#E4E2E8] rounded-2xl max-w-lg w-full p-8 space-y-4">
            <h1 className="font-display text-2xl font-semibold">
              Ocorreu um erro inesperado
            </h1>
            <p className="text-sm text-[#5E5B66] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#7A2E4D] text-white text-xs font-semibold rounded-xl"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [fallbackSession, setFallbackSession] = useState<{
    token: string;
    user: FallbackSessionUser;
  } | null>(() => getStoredFallbackSession());
  const [isOwner, setIsOwner] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);

  const [studioConfig, setStudioConfig] = useState<StudioConfig>(DEFAULT_STUDIO_CONFIG);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<SlotDoc[]>([]);
  const [closures, setClosures] = useState<ClosureDoc[]>([]);
  const [finances, setFinances] = useState<FinanceEntry[]>([]);

  useEffect(() => {
    testFirestoreConnection();
  }, []);

  useEffect(() => {
    const syncFallback = () => {
      setFallbackSession(getStoredFallbackSession());
    };
    window.addEventListener('atelier-session-change', syncFallback);
    window.addEventListener('storage', syncFallback);
    return () => {
      window.removeEventListener('atelier-session-change', syncFallback);
      window.removeEventListener('storage', syncFallback);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setRoleChecked(false);

      if (!user) {
        setIsOwner(false);
        if (!getStoredFallbackSession()) {
          setClientProfile(null);
          setClients([]);
          setAppointments([]);
          setSlots([]);
          setClosures([]);
          setFinances([]);
        }
        setAuthReady(true);
        setRoleChecked(true);
        return;
      }

      try {
        const loginMode = sessionStorage.getItem('atelier_login_mode');
        const isAnneEmail = user.email === 'annecaroline@studioanne.app';
        const isBootstrappedEmail =
          user.emailVerified && user.email === 'egabi4125@gmail.com';

        let adminExists = false;
        try {
          const adminRef = doc(db, 'admins', user.uid);
          const adminSnap = await getDoc(adminRef);
          adminExists = adminSnap.exists();
          if (isAnneEmail && !adminExists) {
            await setDoc(adminRef, {
              role: 'owner',
              username: 'AnneCaroline',
              passkey: 'carol20',
              createdAt: serverTimestamp(),
            });
            adminExists = true;
          }
        } catch {
          adminExists = false;
        }

        const ownerMode =
          isAnneEmail ||
          adminExists ||
          (isBootstrappedEmail && loginMode !== 'client');
        setIsOwner(ownerMode);
      } finally {
        setAuthReady(true);
        setRoleChecked(true);
      }
    });

    return () => unsub();
  }, []);

  const refreshFallbackState = useCallback(async () => {
    const current = getStoredFallbackSession();
    if (!current) return;
    try {
      const data = await apiRequest<{
        studioConfig: StudioConfig;
        clients: ClientProfile[];
        appointments: Appointment[];
        slots: SlotDoc[];
        closures: ClosureDoc[];
        finances: FinanceEntry[];
        clientProfile: ClientProfile | null;
      }>('/api/studio/state');
      setStudioConfig({
        ...DEFAULT_STUDIO_CONFIG,
        ...(data.studioConfig || {}),
      });
      setClients(data.clients || []);
      setAppointments(data.appointments || []);
      setSlots(data.slots || []);
      setClosures(data.closures || []);
      setFinances(data.finances || []);
      setClientProfile(data.clientProfile || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Não autenticado')) {
        clearStoredFallbackSession();
      }
    }
  }, []);

  useEffect(() => {
    if (!authReady || !roleChecked || firebaseUser || !fallbackSession) return;
    refreshFallbackState();
    const timer = window.setInterval(refreshFallbackState, 4000);
    return () => window.clearInterval(timer);
  }, [authReady, roleChecked, firebaseUser, fallbackSession, refreshFallbackState]);

  // Attach Firestore Listeners only when auth is ready & role is resolved
  useEffect(() => {
    if (!authReady || !roleChecked || !firebaseUser) return;

    const unsubscribers: (() => void)[] = [];

    // 1. Studio Config
    unsubscribers.push(
      onSnapshot(
        doc(db, 'studio', 'config'),
        (snap) => {
          if (snap.exists()) {
            setStudioConfig({
              ...DEFAULT_STUDIO_CONFIG,
              ...(snap.data() as StudioConfig),
            });
          } else if (isOwner) {
            setDoc(doc(db, 'studio', 'config'), {
              ...DEFAULT_STUDIO_CONFIG,
              updatedAt: serverTimestamp(),
            }).catch((err) =>
              handleFirestoreError(err, OperationType.WRITE, 'studio/config')
            );
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'studio/config')
      )
    );

    // 2. Booked Slots (Non-PII calendar occupancy)
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'slots'), where('status', '==', 'booked')),
        (snap) => {
          const list: SlotDoc[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SlotDoc, 'id'>),
          }));
          setSlots(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'slots')
      )
    );

    // 3. Agenda Closures
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'closures'), where('type', 'in', ['day', 'week', 'slot'])),
        (snap) => {
          const list: ClosureDoc[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ClosureDoc, 'id'>),
          }));
          setClosures(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'closures')
      )
    );

    if (isOwner) {
      // Owner Listeners: all clients, all appointments, all finances
      unsubscribers.push(
        onSnapshot(
          collection(db, 'clients'),
          (snap) => {
            const list: ClientProfile[] = snap.docs.map((d) => ({
              ...(d.data() as ClientProfile),
              uid: d.id,
            }));
            setClients(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'clients')
        )
      );

      unsubscribers.push(
        onSnapshot(
          collection(db, 'appointments'),
          (snap) => {
            const list: Appointment[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Appointment, 'id'>),
            }));
            setAppointments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'appointments')
        )
      );

      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'finances'), where('type', 'in', ['income', 'fee'])),
          (snap) => {
            const list: FinanceEntry[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<FinanceEntry, 'id'>),
            }));
            setFinances(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'finances')
        )
      );
    } else {
      // Client Listeners: own profile + own appointments only
      unsubscribers.push(
        onSnapshot(
          doc(db, 'clients', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              setClientProfile({
                ...(snap.data() as ClientProfile),
                uid: snap.id,
              });
            } else if (sessionStorage.getItem('atelier_registering') !== '1') {
              // Ensure baseline profile exists if client signed in directly
              setDoc(doc(db, 'clients', firebaseUser.uid), {
                uid: firebaseUser.uid,
                name: firebaseUser.displayName || 'Cliente',
                phone: '(00) 00000-0000',
                email: firebaseUser.email || '',
                wallpaper: 'default',
                wallpaperOpacity: 0.28,
                notes: '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }).catch((err) =>
                handleFirestoreError(
                  err,
                  OperationType.WRITE,
                  `clients/${firebaseUser.uid}`
                )
              );
            }
          },
          (err) =>
            handleFirestoreError(
              err,
              OperationType.GET,
              `clients/${firebaseUser.uid}`
            )
        )
      );

      unsubscribers.push(
        onSnapshot(
          query(
            collection(db, 'appointments'),
            where('clientId', '==', firebaseUser.uid)
          ),
          (snap) => {
            const list: Appointment[] = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Appointment, 'id'>),
            }));
            setAppointments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'appointments')
        )
      );
    }

    return () => {
      unsubscribers.forEach((fn) => fn());
    };
  }, [authReady, roleChecked, firebaseUser, isOwner]);

  const handleLogout = async () => {
    sessionStorage.removeItem('atelier_login_mode');
    clearStoredFallbackSession();
    setClientProfile(null);
    setClients([]);
    setAppointments([]);
    setSlots([]);
    setClosures([]);
    setFinances([]);
    if (auth.currentUser) {
      await signOut(auth);
    }
  };

  if (!authReady || !roleChecked) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="font-display text-2xl font-semibold text-[#16141C]">
            Atelier Anne Caroline
          </p>
          <p className="text-xs text-[#5E5B66]">Carregando agenda...</p>
        </div>
      </div>
    );
  }

  const activeUid = firebaseUser?.uid || fallbackSession?.user.uid || null;
  const effectiveIsOwner = firebaseUser
    ? isOwner
    : fallbackSession?.user.role === 'owner';
  const useServerFallback = Boolean(!firebaseUser && fallbackSession);

  if (!activeUid) {
    return <AuthScreen />;
  }

  if (effectiveIsOwner) {
    return (
      <OwnerPortal
        ownerUid={activeUid}
        clients={clients}
        appointments={appointments}
        slots={slots}
        closures={closures}
        finances={finances}
        studioConfig={studioConfig}
        useServerFallback={useServerFallback}
        onServerRefresh={refreshFallbackState}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ClientPortal
      uid={activeUid}
      clientProfile={clientProfile}
      appointments={appointments}
      slots={slots}
      closures={closures}
      studioConfig={studioConfig}
      emailVerified={firebaseUser ? firebaseUser.emailVerified : true}
      useServerFallback={useServerFallback}
      onServerRefresh={refreshFallbackState}
      onLogout={handleLogout}
    />
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
