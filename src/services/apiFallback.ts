export interface FallbackSessionUser {
  uid: string;
  role: 'client' | 'owner';
  email: string;
  name: string;
}

const TOKEN_KEY = 'atelier_fallback_token';
const USER_KEY = 'atelier_fallback_user';

export function getStoredFallbackSession(): {
  token: string;
  user: FallbackSessionUser;
} | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) as FallbackSessionUser };
  } catch {
    return null;
  }
}

export function setStoredFallbackSession(
  token: string,
  user: FallbackSessionUser
) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event('atelier-session-change'));
}

export function clearStoredFallbackSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('atelier-session-change'));
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const session = getStoredFallbackSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao comunicar com o servidor.');
  }
  return data;
}
