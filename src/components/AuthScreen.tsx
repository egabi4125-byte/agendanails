import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  apiRequest,
  FallbackSessionUser,
  setStoredFallbackSession,
} from '../services/apiFallback';
import { STUDIO_IMAGES } from '../types';

type AuthTab = 'login' | 'register' | 'forgot' | 'admin';

export const AuthScreen: React.FC = () => {
  const [tab, setTab] = useState<AuthTab>('login');

  // Client Login
  const [clientEmail, setClientEmail] = useState('');
  const [clientPassword, setClientPassword] = useState('');

  // Client Register
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Forgot Password
  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetStepDirect, setResetStepDirect] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Admin Login
  const [adminUser, setAdminUser] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [avatarImgFailed, setAvatarImgFailed] = useState(false);

  const isProviderDisabledError = (err: unknown): boolean => {
    const code = (err as { code?: string })?.code || '';
    const msg = err instanceof Error ? err.message : String(err);
    return (
      code === 'auth/operation-not-allowed' ||
      code === 'auth/configuration-not-found' ||
      code === 'auth/admin-restricted-operation' ||
      msg.includes('PASSWORD_LOGIN_DISABLED') ||
      msg.includes('ADMIN_ONLY_OPERATION') ||
      msg.includes('operation-not-allowed')
    );
  };

  const mapAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/email-already-in-use') {
      return 'Este e-mail já está cadastrado. Acesse a aba Entrar ou recupere sua senha.';
    }
    if (code === 'auth/weak-password') {
      return 'A senha deve ter no mínimo 6 caracteres.';
    }
    if (code === 'auth/invalid-email') {
      return 'Informe um endereço de e-mail válido.';
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found'
    ) {
      return 'E-mail ou senha incorretos. Verifique seus dados ou use "Esqueceu a senha?".';
    }
    if (code === 'auth/too-many-requests') {
      return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Login com Google cancelado.';
    }
    return err instanceof Error
      ? err.message
      : 'Não foi possível concluir a autenticação.';
  };

  const ensureClientProfile = async (
    uid: string,
    name: string,
    phone: string,
    email: string
  ) => {
    const clientRef = doc(db, 'clients', uid);
    try {
      const snap = await getDoc(clientRef);
      if (!snap.exists()) {
        await setDoc(clientRef, {
          uid,
          name: name.trim().slice(0, 100) || 'Cliente',
          phone: phone.trim().slice(0, 25) || '(00) 00000-0000',
          email: email.trim().slice(0, 120),
          wallpaper: 'default',
          wallpaperOpacity: 0.28,
          notes: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `clients/${uid}`);
    }
  };

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const emailTrim = clientEmail.trim();
    if (
      emailTrim === 'AnneCaroline' ||
      emailTrim.toLowerCase() === 'annecaroline@studioanne.app'
    ) {
      setErrorMsg(
        'Esta área é exclusiva para clientes. Clique em "Entrar como Administrador" abaixo para acessar o perfil administrativo.'
      );
      return;
    }

    setLoading(true);
    try {
      sessionStorage.setItem('atelier_login_mode', 'client');
      try {
        const cred = await signInWithEmailAndPassword(
          auth,
          emailTrim,
          clientPassword
        );
        await ensureClientProfile(
          cred.user.uid,
          cred.user.displayName || 'Cliente',
          '(00) 00000-0000',
          cred.user.email || emailTrim
        );
      } catch (fbErr) {
        if (isProviderDisabledError(fbErr)) {
          const res = await apiRequest<{
            token: string;
            user: FallbackSessionUser;
          }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              email: emailTrim,
              password: clientPassword,
            }),
          });
          setStoredFallbackSession(res.token, res.user);
        } else {
          throw fbErr;
        }
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClientRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (regName.trim().length < 2) {
      setErrorMsg('Informe seu nome completo.');
      return;
    }
    if (regPhone.replace(/\D/g, '').length < 8) {
      setErrorMsg('Informe um telefone/WhatsApp válido com DDD.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      sessionStorage.setItem('atelier_login_mode', 'client');
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          regEmail.trim(),
          regPassword
        );
        await updateProfile(cred.user, { displayName: regName.trim() });
        await ensureClientProfile(
          cred.user.uid,
          regName.trim(),
          regPhone.trim(),
          regEmail.trim()
        );
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // Non-blocking verification email
        }
      } catch (fbErr) {
        if (isProviderDisabledError(fbErr)) {
          const res = await apiRequest<{
            token: string;
            user: FallbackSessionUser;
          }>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              name: regName.trim(),
              phone: regPhone.trim(),
              email: regEmail.trim(),
              password: regPassword,
            }),
          });
          setStoredFallbackSession(res.token, res.user);
        } else {
          throw fbErr;
        }
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setResetSent(false);
    setLoading(true);
    try {
      if (resetStepDirect) {
        await apiRequest('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            email: resetEmail.trim(),
            newPassword: resetNewPassword,
          }),
        });
        setResetSent(true);
        setResetStepDirect(false);
        setResetNewPassword('');
        return;
      }

      try {
        await sendPasswordResetEmail(auth, resetEmail.trim());
        setResetSent(true);
      } catch (fbErr) {
        if (isProviderDisabledError(fbErr)) {
          await apiRequest('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ email: resetEmail.trim() }),
          });
          setResetStepDirect(true);
        } else {
          throw fbErr;
        }
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (adminUser.trim() !== 'AnneCaroline' || adminPassword !== 'carol1234') {
      setErrorMsg('Usuário ou senha de administrador inválidos.');
      return;
    }

    setLoading(true);
    try {
      sessionStorage.setItem('atelier_login_mode', 'admin');
      const ownerEmail = 'annecaroline@studioanne.app';
      try {
        let userCred;
        try {
          userCred = await signInWithEmailAndPassword(
            auth,
            ownerEmail,
            'carol1234'
          );
        } catch (signInErr) {
          const code = (signInErr as { code?: string })?.code || '';
          if (
            code === 'auth/user-not-found' ||
            code === 'auth/invalid-credential'
          ) {
            userCred = await createUserWithEmailAndPassword(
              auth,
              ownerEmail,
              'carol1234'
            );
            await updateProfile(userCred.user, {
              displayName: 'Anne Caroline',
            });
          } else {
            throw signInErr;
          }
        }

        const adminRef = doc(db, 'admins', userCred.user.uid);
        const snap = await getDoc(adminRef);
        if (!snap.exists()) {
          await setDoc(adminRef, {
            role: 'owner',
            username: 'AnneCaroline',
            passkey: 'carol1234',
            createdAt: serverTimestamp(),
          });
        }
      } catch (fbErr) {
        if (isProviderDisabledError(fbErr)) {
          const res = await apiRequest<{
            token: string;
            user: FallbackSessionUser;
          }>('/api/auth/admin-login', {
            method: 'POST',
            body: JSON.stringify({
              username: adminUser.trim(),
              password: adminPassword,
            }),
          });
          setStoredFallbackSession(res.token, res.user);
        } else {
          throw fbErr;
        }
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async (mode: 'client' | 'admin') => {
    setErrorMsg(null);
    setLoading(true);
    try {
      sessionStorage.setItem('atelier_login_mode', mode);
      const cred = await signInWithPopup(auth, googleProvider);
      if (mode === 'client') {
        await ensureClientProfile(
          cred.user.uid,
          cred.user.displayName || 'Cliente',
          '(00) 00000-0000',
          cred.user.email || ''
        );
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#16141C] flex items-center justify-center p-4 sm:p-6 lg:p-10">
      <main className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        {/* Left Studio Visual Column */}
        <section className="lg:col-span-6 relative rounded-2xl overflow-hidden border border-[#E4E2E8] bg-[#16141C] min-h-[300px] lg:min-h-[600px] flex flex-col justify-end">
          {!heroImgFailed ? (
            <img
              src={STUDIO_IMAGES.hero}
              alt="Atelier Anne Caroline Nail Designer"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#2B1A22] via-[#4A2535] to-[#16141C]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

          <div className="relative z-10 p-8 sm:p-10 text-white space-y-6">
            <div className="space-y-2.5">
              <p className="text-xs font-medium tracking-widest uppercase text-white/80">
                Atelier Anne Caroline
              </p>
              <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-tight text-balance">
                Agenda exclusiva de nail design.
              </h1>
            </div>

            <div className="pt-5 border-t border-white/20 flex items-center gap-4">
              {!avatarImgFailed ? (
                <img
                  src={STUDIO_IMAGES.ownerAvatar}
                  alt="Anne Caroline Nail Designer"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarImgFailed(true)}
                  className="w-12 h-12 rounded-full object-cover border border-white/40 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-[#7A2E4D] flex items-center justify-center text-white font-semibold shrink-0">
                  AC
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-white">Anne Caroline</p>
                <p className="text-xs text-white/75">
                  Fibra de Vidro · Banho de Gel · Esmaltação
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Right Auth Card */}
        <section className="lg:col-span-6 bg-white border border-[#E4E2E8] rounded-2xl p-6 sm:p-10 flex flex-col justify-between">
          <div className="space-y-6">
            {/* Client Segmented Options (Entrar / Cadastrar-se) when not in Admin view */}
            {tab !== 'admin' && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F2F5] rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setErrorMsg(null);
                    setResetSent(false);
                    setResetStepDirect(false);
                  }}
                  className={`py-2.5 px-4 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    tab === 'login' || tab === 'forgot'
                      ? 'bg-white text-[#16141C] shadow-xs'
                      : 'text-[#5E5B66] hover:text-[#16141C]'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setErrorMsg(null);
                  }}
                  className={`py-2.5 px-4 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    tab === 'register'
                      ? 'bg-white text-[#16141C] shadow-xs'
                      : 'text-[#5E5B66] hover:text-[#16141C]'
                  }`}
                >
                  Cadastrar-se
                </button>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
              >
                <p className="font-medium">{errorMsg}</p>
              </div>
            )}

            {/* VIEW 1: CLIENT LOGIN */}
            {tab === 'login' && (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-3xl font-semibold text-[#16141C]">
                    Entrar como Cliente
                  </h2>
                  <p className="text-sm text-[#5E5B66] mt-1">
                    Informe seu e-mail cadastrado e senha para acessar sua agenda.
                  </p>
                </div>

                <form onSubmit={handleClientLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                      E-mail
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="seuemail@exemplo.com"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-[#16141C]">
                        Senha
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setTab('forgot');
                          setResetEmail(clientEmail);
                          setErrorMsg(null);
                          setResetSent(false);
                          setResetStepDirect(false);
                        }}
                        className="text-xs font-medium text-[#7A2E4D] hover:underline"
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        value={clientPassword}
                        onChange={(e) => setClientPassword(e.target.value)}
                        placeholder="Sua senha"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-5 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <span>{loading ? 'Entrando...' : 'Entrar'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-[#E4E2E8]" />
                  <span className="shrink mx-3 text-xs text-[#5E5B66]">
                    ou acesse com
                  </span>
                  <div className="flex-grow border-t border-[#E4E2E8]" />
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleGoogleSignIn('client')}
                  className="w-full py-2.5 px-4 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-sm font-medium text-[#16141C] transition-colors flex items-center justify-center gap-2"
                >
                  <span>Continuar com Google</span>
                </button>
              </div>
            )}

            {/* VIEW 2: CLIENT REGISTER */}
            {tab === 'register' && (
              <div className="space-y-5">
                <div>
                  <h2 className="font-display text-3xl font-semibold text-[#16141C]">
                    Cadastrar-se como Cliente
                  </h2>
                  <p className="text-sm text-[#5E5B66] mt-1">
                    Preencha seus dados para acessar a agenda e salvar suas reservas.
                  </p>
                </div>

                <form onSubmit={handleClientRegister} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Nome completo
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Ex: Maria Clara Oliveira"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        Telefone (WhatsApp)
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          required
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          placeholder="(11) 99999-9999"
                          className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1">
                        E-mail (para recuperação)
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="maria@email.com"
                          className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1">
                      Senha (mínimo 6 caracteres)
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Crie uma senha segura"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-5 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <span>
                      {loading ? 'Salvando cadastro...' : 'Cadastrar-se'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}

            {/* VIEW 3: FORGOT PASSWORD */}
            {tab === 'forgot' && (
              <div className="space-y-5">
                <div>
                  <h2 className="font-display text-3xl font-semibold text-[#16141C]">
                    Recuperar senha por e-mail
                  </h2>
                  <p className="text-sm text-[#5E5B66] mt-1">
                    {resetStepDirect
                      ? 'E-mail localizado. Defina uma nova senha para sua conta.'
                      : 'Informe seu e-mail cadastrado para recuperar seu acesso.'}
                  </p>
                </div>

                {resetSent ? (
                  <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      <span>Senha atualizada com sucesso</span>
                    </div>
                    <p className="text-sm">
                      Verifique seu e-mail ou entre agora usando sua nova senha em{' '}
                      <span className="font-semibold">{resetEmail}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('login');
                        setResetSent(false);
                      }}
                      className="text-sm font-semibold text-[#7A2E4D] hover:underline"
                    >
                      Voltar para o login
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                        E-mail cadastrado
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          disabled={resetStepDirect}
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="seuemail@exemplo.com"
                          className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                        />
                      </div>
                    </div>

                    {resetStepDirect && (
                      <div>
                        <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                          Nova senha (mínimo 6 caracteres)
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={resetNewPassword}
                            onChange={(e) => setResetNewPassword(e.target.value)}
                            placeholder="Digite a nova senha"
                            className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 px-5 bg-[#7A2E4D] hover:bg-[#61233C] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {loading
                        ? 'Processando...'
                        : resetStepDirect
                        ? 'Salvar Nova Senha'
                        : 'Recuperar Acesso'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setTab('login');
                        setResetStepDirect(false);
                      }}
                      className="w-full text-center text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
                    >
                      Voltar para entrar
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* VIEW 4: SEPARATE ADMIN LOGIN */}
            {tab === 'admin' && (
              <div className="space-y-6">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setErrorMsg(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5E5B66] hover:text-[#16141C]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar para acesso de cliente</span>
                </button>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F3F2F5] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-[#7A2E4D]" />
                  </div>
                  <div>
                    <h2 className="font-display text-3xl font-semibold text-[#16141C]">
                      Login do Administrador
                    </h2>
                    <p className="text-sm text-[#5E5B66] mt-0.5">
                      Acesso exclusivo para gerenciar agenda, clientes, bloqueios, localização e finanças.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                      Usuário do administrador
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={adminUser}
                        onChange={(e) => setAdminUser(e.target.value)}
                        placeholder="Nome de usuário"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#16141C] mb-1.5">
                      Senha
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#5E5B66] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Senha de acesso"
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-[#E4E2E8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#7A2E4D]/25 focus:border-[#7A2E4D]"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 px-5 bg-[#16141C] hover:bg-[#2C2836] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <span>
                      {loading ? 'Autenticando...' : 'Entrar como Administrador'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="pt-2 border-t border-[#E4E2E8]">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleGoogleSignIn('admin')}
                    className="w-full py-2.5 px-4 border border-[#E4E2E8] hover:bg-[#F3F2F5] rounded-xl text-xs font-medium text-[#5E5B66] hover:text-[#16141C] transition-colors"
                  >
                    Entrar com conta Google administradora
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Separate Admin Access Switch at the bottom of Client Login/Register */}
          {tab !== 'admin' && (
            <div className="pt-6 mt-6 border-t border-[#E4E2E8] flex items-center justify-between gap-3">
              <span className="text-xs text-[#5E5B66]">
                É a proprietária do estúdio?
              </span>
              <button
                type="button"
                onClick={() => {
                  setTab('admin');
                  setErrorMsg(null);
                }}
                className="text-xs font-semibold text-[#16141C] hover:text-[#7A2E4D] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#7A2E4D]" />
                <span>Entrar como Administrador</span>
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
