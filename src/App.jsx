import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  deleteDoc,
  writeBatch,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from './firebase';

const APP_NAME = 'ZanTGrams';
const ADMIN_EMAIL = 'm462556532@gmail.com';
// Global chat removed. If user has no chats, show empty state.
const GLOBAL_CHAT_ID = null;
// Bot directory id (legacy). Real per-user chat id is resolved at runtime.
const CREATEBOT_USERNAME = 'createbot';
const getCreatebotChatId = (uid) => `bot_createbot_${uid}`;
const SYSTEM_BOT_USERNAME = 'zantgrams';
const SYSTEM_CHANNEL_ID = 'zantgrams';

// Emoji avatars (fallback when user doesn't upload an image)
const EMOJI_AVATARS = [
  '👽','😈','😎','💀','👻','🐸','🦄','🐲','🧠','🦊','🐱','🐶','🐵','🐼','🦈','⚔️','🪄','🚀','🍉','🍕','🍞',
];

function DefaultAvatarSvg() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M13 2 4 14h7l-1 8 10-12h-7l0-8Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M13 2 4 14h7l-1 8 10-12h-7l0-8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.35"
      />
    </svg>
  );
}

function prettyTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function safeSlug(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function nowMs() {
  return Date.now();
}

function banUntilMs(ban) {
  if (!ban) return 0;
  const u = ban.until;
  try {
    if (typeof u === 'number') return u;
    if (u?.toDate) return u.toDate().getTime();
    if (u instanceof Date) return u.getTime();
  } catch {
    // ignore
  }
  return 0;
}

async function fileToDataUrlResized(file, { maxSide = 1280, quality = 0.82 } = {}) {
  // Reads an image file, resizes on the client, returns a JPEG dataURL.
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas ctx');
    ctx.drawImage(img, 0, 0, outW, outH);

    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function imageFileToDataUrlUnderLimit(
  file,
  {
    limitChars = 780_000,
    maxSideCandidates = [1400, 1200, 1000, 900, 800],
    qualityCandidates = [0.82, 0.76, 0.70, 0.64, 0.58],
  } = {}
) {
  // Firestore документ ~1 MiB. DataURL в виде строки быстро раздувается,
  // поэтому подбираем параметры сжатия, чтобы стабильно влезать в лимит.
  for (const maxSide of maxSideCandidates) {
    for (const quality of qualityCandidates) {
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await fileToDataUrlResized(file, { maxSide, quality });
      if (dataUrl && dataUrl.length <= limitChars) return dataUrl;
    }
  }
  throw new Error('IMAGE_TOO_LARGE');
}

function badgeText(u) {
  const badges = [];
  if (u?.badges?.verified) badges.push('✅');
  if (u?.badges?.youtube) badges.push('▶️');
  if (u?.badges?.premium) badges.push('💎');
  if (u?.badges?.moderator) badges.push('🛡️');
  return badges.join(' ');
}

function VerifiedBadge() {
  // стиль как на примере: круглый бейдж с иконкой
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#3b82f6] ring-1 ring-white/15 opacity-75 hover:opacity-100 transition" title="Верифицирован">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-white">
        <path
          fill="currentColor"
          d="M12 2l2.4 2.2 3.2-.6 1 3.1 3 1.2-1.2 3 1.2 3-3 1.2-1 3.1-3.2-.6L12 22l-2.4-2.2-3.2.6-1-3.1-3-1.2 1.2-3-1.2-3 3-1.2 1-3.1 3.2.6L12 2zm-1.1 14.2l7-7-1.4-1.4-5.6 5.6-2.6-2.6-1.4 1.4 4 4z"
        />
      </svg>
    </span>
  );
}

function PremiumBadge() {
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#d4a017] ring-1 ring-white/15 opacity-75 hover:opacity-100 transition" title="Премиум">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-white">
        <path
          fill="currentColor"
          d="M12 2 9.5 7.5 4 8.2l4 3.9L7 18l5-2.8L17 18l-1-5.9 4-3.9-5.5-.7L12 2z"
        />
      </svg>
    </span>
  );
}

function YoutubeBadge() {
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#ef4444] ring-1 ring-white/15 opacity-75 hover:opacity-100 transition" title="YouTube">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-white">
        <path
          fill="currentColor"
          d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5A3 3 0 0 0 2.4 7.2 31.6 31.6 0 0 0 2 12a31.6 31.6 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31.6 31.6 0 0 0 22 12a31.6 31.6 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"
        />
      </svg>
    </span>
  );
}

function ModerationBadge() {
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#7c3aed] ring-1 ring-white/15 opacity-75 hover:opacity-100 transition" title="Модерация">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-white">
        <path
          fill="currentColor"
          d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.1 13.2-3-3 1.4-1.4 1.6 1.6 4.9-4.9 1.4 1.4-6.3 6.3Z"
        />
      </svg>
    </span>
  );
}

function BadgesInline({ badges, onBadgeClick }) {
  const b = badges || {};
  return (
    <span className="inline-flex items-center gap-1">
      {b.premium && (
        <button type="button" className="inline-flex" onClick={() => onBadgeClick?.('premium')}>
          <PremiumBadge />
        </button>
      )}
      {b.verified && (
        <button type="button" className="inline-flex" onClick={() => onBadgeClick?.('verified')}>
          <VerifiedBadge />
        </button>
      )}
      {b.youtube && (
        <button type="button" className="inline-flex" onClick={() => onBadgeClick?.('youtube')}>
          <YoutubeBadge />
        </button>
      )}
      {b.moderator && (
        <button type="button" className="inline-flex" onClick={() => onBadgeClick?.('moderator')}>
          <ModerationBadge />
        </button>
      )}
    </span>
  );
}

function ChatVerifiedBadge() {
  // галочка для каналов/групп (выдаётся админом)
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#2a5cff]/20 ring-1 ring-[#2a5cff]/40 opacity-75 hover:opacity-100 transition" title="Верифицированный канал/группа">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-[#4ea1ff]">
        <path
          fill="currentColor"
          d="M12 2l2.4 2.2 3.2-.6 1 3.1 3 1.2-1.2 3 1.2 3-3 1.2-1 3.1-3.2-.6L12 22l-2.4-2.2-3.2.6-1-3.1-3-1.2 1.2-3-1.2-3 3-1.2 1-3.1 3.2.6L12 2zm-1.1 14.2l7-7-1.4-1.4-5.6 5.6-2.6-2.6-1.4 1.4 4 4z"
        />
      </svg>
    </span>
  );
}


export default function App() {
  const [fbUser, setFbUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFbUser(u);
      if (!u) {
        setProfile(null);
        setBooting(false);
        return;
      }

      // Ensure profile exists
      const userRef = doc(db, 'users', u.uid);
      const snap = await getDoc(userRef);

      const defaultUsername = safeSlug(u.displayName) || `user_${u.uid.slice(0, 6)}`;

      if (!snap.exists()) {
        await setDoc(userRef, {
uid: u.uid,
email: u.email || null,
username: defaultUsername,
displayName: u.displayName || defaultUsername,
about: '',
avatar_data_url: u.photoURL || '',
avatar_emoji: '',
stars: 0,
badges: { verified: false, youtube: false, premium: false, moderator: false },
usernameUpdatedAt: serverTimestamp(),
onboarded: false,
createdAt: serverTimestamp(),
        });
      } else {
        // backfill missing fields for older docs
        const data = snap.data() || {};
        const patch = {};
        if (!data.username) patch.username = defaultUsername;
        if (!data.displayName) patch.displayName = u.displayName || defaultUsername;
        if (data.about == null) patch.about = '';
        if (data.onboarded == null) patch.onboarded = false;

        if (data.avatar_data_url == null) patch.avatar_data_url = u.photoURL || '';
        if (data.avatar_emoji == null) patch.avatar_emoji = '';
        if (!data.badges) patch.badges = { verified: false, youtube: false, premium: false, moderator: false };
        if (!data.usernameUpdatedAt) patch.usernameUpdatedAt = serverTimestamp();
        if (data.stars == null) patch.stars = 0;
        if (Object.keys(patch).length) await updateDoc(userRef, patch);
      }

// Ensure system channel exists for everyone
try {
  const chRef = doc(db, 'chats', SYSTEM_CHANNEL_ID);
  const chSnap = await getDoc(chRef);
  if (!chSnap.exists()) {
    await setDoc(chRef, {
      id: SYSTEM_CHANNEL_ID,
      type: 'channel',
      title: APP_NAME,
      description: 'Официальный канал проекта',
      username: 'zantgrams',
      visibility: 'public',
      ownerUid: u.uid,
      admins: [u.uid],
      members: [],
      avatar_data_url: '',
      verified: true,
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });
  }
} catch {
  // ignore
}

// Ensure per-user @createbot chat exists (so everyone's chat history is private)
try {
  const myCreatebotChatId = getCreatebotChatId(u.uid);
  const myBotRef = doc(db, 'chats', myCreatebotChatId);
  const myBotSnap = await getDoc(myBotRef);
  if (!myBotSnap.exists()) {
    await setDoc(myBotRef, {
      id: myCreatebotChatId,
      type: 'bot',
      botUsername: 'createbot',
      title: 'CreateBot',
      description: 'Создание ботов (как BotFather)',
      username: 'createbot',
      visibility: 'private',
      ownerUid: u.uid,
      admins: [u.uid],
      members: [u.uid],
      avatar_data_url: '',
      verified: true,
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });
  }
} catch {
  // ignore
}

// Ensure per-user Images chat exists (image-only personal chat)
try {
  const imagesChatId = `images_${u.uid}`;
  const imgRef = doc(db, 'chats', imagesChatId);
  const imgSnap = await getDoc(imgRef);
  if (!imgSnap.exists()) {
    await setDoc(imgRef, {
      id: imagesChatId,
      type: 'images',
      title: 'Фото',
      description: 'Личный чат только для изображений',
      username: '',
      visibility: 'private',
      ownerUid: u.uid,
      admins: [u.uid],
      members: [u.uid],
      avatar_data_url: '',
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
    });
  }
} catch {
  // ignore
}

// Load profile
      const fresh = await getDoc(userRef);
      const data = fresh.data() || {};
      setProfile({
        uid: u.uid,
        email: u.email || '',
        username: data.username || defaultUsername,
        avatar_data_url: data.avatar_data_url || '',
        avatar_emoji: data.avatar_emoji || '',
        badges: data.badges || {},
                displayName: data.displayName || u.displayName || (data.username || defaultUsername),
        about: data.about || '',
        onboarded: data.onboarded === true,
        usernameUpdatedAt: data.usernameUpdatedAt || null,
        ban: data.ban || null,
      });

      setBooting(false);
    });

    return () => unsub();
  // IMPORTANT: do not depend on profile here (profile is null during boot)
  }, []);

  if (booting) {
    return (
      <div className="h-screen w-screen bg-tgDark text-tgText flex items-center justify-center">
        <div className="text-tgHint">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-tgDark text-tgText flex overflow-hidden font-sans">
      {!fbUser || !profile ? (
        <AuthScreen />
      ) : !profile.onboarded ? (
        <OnboardingScreen profile={profile} onProfileUpdated={(p) => setProfile(p)} />
      ) : (
        <AuthedRoutes profile={profile} onLogout={() => signOut(auth)} />
      )}

      <CookieBanner />
    </div>
  );
}

function CookieBanner() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    try {
      setOk(localStorage.getItem('zg_cookie_ok') === '1');
    } catch {
      setOk(true);
    }
  }, []);

  if (ok) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 z-50">
      <div className="max-w-[980px] mx-auto bg-tgPanel border border-white/10 rounded-2xl p-4 shadow-2xl flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="text-sm text-white/90">
          Мы используем cookies для работы сайта. Продолжая, ты соглашаешься с политикой cookies.
        </div>
        <div className="sm:ml-auto flex gap-2">
          <a href="/cookies" className="px-4 py-2 rounded-xl bg-tgDark border border-white/10 text-tgHint hover:text-white">Подробнее</a>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-tgBlue text-white font-bold"
            onClick={() => {
              try { localStorage.setItem('zg_cookie_ok', '1'); } catch {}
              setOk(true);
            }}
          >
            Ок
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthedRoutes({ profile, onLogout }) {
  return (
    <Routes>
      <Route path="/" element={<Messenger profile={profile} onLogout={onLogout} routeTarget={null} />} />
      <Route
        path="/c/:username"
        element={<ChatRoute profile={profile} onLogout={onLogout} mode="username" />}
      />
      <Route path="/chat/:id" element={<ChatRoute profile={profile} onLogout={onLogout} mode="id" />} />
      <Route path="/u/:username" element={<ProfilePage me={profile} />} />
      <Route path="/id/:uid" element={<ProfilePage me={profile} mode="uid" />} />
      <Route path="/invite/:code" element={<InviteRoute profile={profile} />} />
      <Route path="/admin" element={<AdminPage me={profile} />} />
      <Route path="/wallet" element={<WalletPage me={profile} />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/cookies" element={<LegalPage kind="cookies" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ChatRoute({ profile, onLogout, mode }) {
  const params = useParams();
  const target = mode === 'username' ? { type: 'chatUsername', value: params.username } : { type: 'chatId', value: params.id };
  return <Messenger profile={profile} onLogout={onLogout} routeTarget={target} />;
}

function InviteRoute({ profile }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('joining');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const qC = query(collection(db, 'chats'), where('inviteCode', '==', String(code || '')), limit(1));
        const s = await getDocs(qC);
        const d0 = s.docs[0];
        if (!d0) {
          setStatus('notfound');
          return;
        }
        const chatId = d0.id;
        const data = d0.data() || {};
        const ref = doc(db, 'chats', chatId);
        const members = Array.isArray(data.members) ? data.members : [];
        if (!members.includes(profile.uid)) {
          await updateDoc(ref, { members: [...members, profile.uid] });
        }
        if (cancelled) return;

        if (data.username) navigate(`/c/${data.username}`, { replace: true });
        else navigate(`/chat/${chatId}`, { replace: true });
      } catch (e) {
        console.error(e);
        setStatus('error');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [code, navigate, profile.uid]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[520px] max-w-[92vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
        {status === 'joining' && <div className="text-tgHint">Подключаем к чату…</div>}
        {status === 'notfound' && <div className="text-red-400">Приглашение недействительно.</div>}
        {status === 'error' && <div className="text-red-400">Не удалось подключиться.</div>}
        <button className="mt-4 px-4 py-3 rounded bg-tgBlue text-white font-bold" onClick={() => navigate('/')} type="button">
          На главную
        </button>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');

  const signInGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      // Popup blocked → redirect fallback
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/popup-closed-by-user') {
        try {
          const provider = new GoogleAuthProvider();
          await signInWithRedirect(auth, provider);
          return;
        } catch (e2) {
          setError(String(e2?.message || e2));
        }
      } else if (e?.code === 'auth/unauthorized-domain') {
        setError('Домен не разрешён. Добавь домен Vercel в Firebase → Authentication → Authorized domains.');
      } else if (e?.code === 'auth/operation-not-allowed') {
        setError('Google-вход не включён. Включи Google provider в Firebase → Authentication → Sign-in method.');
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      setBusy(false);
    }
  };

  const signInEmail = async () => {
    setError('');
    setBusy(true);
    try {
      const e = email.trim();
      if (!e || !pass) {
        setError('Введите email и пароль.');
        return;
      }
      if (mode === 'register') {
        await createUserWithEmailAndPassword(auth, e, pass);
      } else {
        await signInWithEmailAndPassword(auth, e, pass);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError('');
    const e = email.trim();
    if (!e) {
      setError('Введи email, чтобы сбросить пароль.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, e);
      alert('Письмо для сброса пароля отправлено.');
    } catch (e2) {
      setError(String(e2?.message || e2));
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[420px] max-w-[92vw] p-8 bg-tgPanel rounded-xl shadow-2xl flex flex-col items-center border border-white/10">
        <img src="/logo.svg" alt="Logo" className="w-28 h-28 mb-5" />
        <h2 className="text-2xl font-bold mb-1 text-white">{APP_NAME}</h2>
        <div className="text-tgHint text-sm mb-6">Вход по Email или Google</div>

        <div className="w-full flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded border border-white/10 text-sm font-bold ${mode === 'login' ? 'bg-white/10 text-white' : 'bg-tgDark text-tgHint hover:text-white'}`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded border border-white/10 text-sm font-bold ${mode === 'register' ? 'bg-white/10 text-white' : 'bg-tgDark text-tgHint hover:text-white'}`}
          >
            Регистрация
          </button>
        </div>

        {error && <div className="text-red-400 mb-3 text-sm text-center">{error}</div>}

        <div className="w-full flex flex-col gap-2">
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Email…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Пароль…"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          <button
            onClick={signInEmail}
            disabled={busy}
            className="w-full p-3 rounded bg-tgBlue hover:bg-blue-600 font-bold uppercase text-sm transition text-white disabled:opacity-60"
            type="button"
          >
            {busy ? '...' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="text-tgHint text-xs hover:text-white self-start mt-1"
              onClick={reset}
            >
              Забыли пароль?
            </button>
          )}
        </div>

        <div className="my-4 w-full flex items-center gap-3">
          <div className="h-px bg-white/10 flex-1" />
          <div className="text-tgHint text-xs">или</div>
          <div className="h-px bg-white/10 flex-1" />
        </div>

        <button
          onClick={signInGoogle}
          disabled={busy}
          className="w-full p-3 rounded bg-white/10 hover:bg-white/15 font-bold uppercase text-sm transition text-white border border-white/10 disabled:opacity-60"
          type="button"
        >
          {busy ? '...' : 'Войти через Google'}
        </button>

        <div className="mt-5 text-tgHint text-xs text-center">
          Для Vercel добавь домен в Firebase → Authentication → Authorized domains.
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({ profile, onProfileUpdated }) {
  const [username, setUsername] = useState(profile.username || '');
  const [displayName, setDisplayName] = useState(profile.displayName || profile.username || '');
  const [about, setAbout] = useState(profile.about || '');
  const [avatar, setAvatar] = useState(profile.avatar_data_url || '');
  const [avatarEmoji, setAvatarEmoji] = useState(profile.avatar_emoji || '');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickAvatar = async (file) => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await imageFileToDataUrlUnderLimit(file, { limitChars: 420_000, maxSideCandidates: [640, 560, 480, 420], qualityCandidates: [0.82, 0.74, 0.66, 0.58] });
      setAvatar(dataUrl);
      setAvatarEmoji('');
    } catch (e) {
      setError('Аватар слишком большой. Возьми картинку поменьше.');
    }
  };

  const finish = async () => {
    const slug = safeSlug(username);
    if (slug.length < 3) return setError('Username минимум 3 символа (a-z 0-9 _).');
    if (displayName.trim().length < 2) return setError('Имя минимум 2 символа.');
    setBusy(true);
    setError('');
    try {
      // unique username
      const qU = query(collection(db, 'users'), where('username', '==', slug), limit(1));
      const s = await getDocs(qU);
      const exists = s.docs.some((d) => d.id !== profile.uid);
      if (exists) {
        setError('Этот @username уже занят.');
        return;
      }

      const ref = doc(db, 'users', profile.uid);
      await updateDoc(ref, {
        username: slug,
        displayName: displayName.trim(),
        about: about.trim(),
        avatar_data_url: avatar || '',
        avatar_emoji: avatar ? '' : (avatarEmoji || ''),
        onboarded: true,
        usernameUpdatedAt: serverTimestamp(),
      });

      try {
        await updateProfile(auth.currentUser, { displayName: displayName.trim(), photoURL: avatar || '' });
      } catch {
        // ignore
      }

      onProfileUpdated({
        ...profile,
        username: slug,
        displayName: displayName.trim(),
        about: about.trim(),
        avatar_data_url: avatar || '',
        avatar_emoji: avatar ? '' : (avatarEmoji || ''),
        onboarded: true,
      });
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[520px] max-w-[92vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
        <div className="text-white font-bold text-xl">Создай профиль</div>
        <div className="text-tgHint text-sm mt-1">Придумай @username, имя, описание и выбери аватар.</div>

        <div className="mt-5 flex items-center gap-4">
          <AvatarCircle dataUrl={avatar} emoji={avatarEmoji} fallback={displayName || username || 'U'} />
          <div className="flex flex-col gap-2">
            <label className="px-4 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white cursor-pointer w-fit">
              Загрузить фото
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickAvatar(e.target.files?.[0])} />
            </label>
            <button
              type="button"
              className="px-4 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white w-fit"
              onClick={() => setShowEmojiPicker(true)}
            >
              Выбрать эмодзи
            </button>
          </div>
        </div>

        {showEmojiPicker && (
          <EmojiAvatarPicker
            value={avatarEmoji}
            onPick={(e) => {
              setAvatar('');
              setAvatarEmoji(e);
              setShowEmojiPicker(false);
            }}
            onClose={() => setShowEmojiPicker(false)}
          />
        )}

        <div className="mt-4 flex flex-col gap-3">
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="@username (a-z 0-9 _)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Название / ник…"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <textarea
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[110px]"
            placeholder="Описание…"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>

        {error && <div className="text-red-400 mt-3 text-sm">{error}</div>}

        <div className="mt-6 flex gap-2">
          <button
            className="flex-1 py-3 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold disabled:opacity-60"
            disabled={busy}
            onClick={finish}
            type="button"
          >
            {busy ? '...' : 'Войти'}
          </button>
          <button
            className="px-4 py-3 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
            onClick={() => signOut(auth)}
            type="button"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}

function Messenger({ profile: initialProfile, onLogout, routeTarget }) {
  const [profile, setProfile] = useState(initialProfile);
  const [activeChat, setActiveChat] = useState(null);
  const [chats, setChats] = useState([]); // merged
  const [chatsPublic, setChatsPublic] = useState([]);
  const [chatsMember, setChatsMember] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [showPostComposer, setShowPostComposer] = useState(false);
  const [viewImage, setViewImage] = useState(null);
  const [viewPost, setViewPost] = useState(null);
  const [miniAppUrl, setMiniAppUrl] = useState(null);
  const [showCreateBot, setShowCreateBot] = useState(false);

  const [badgeInfo, setBadgeInfo] = useState(null);
  const [showHamburger, setShowHamburger] = useState(false);
  const [toast, setToast] = useState(null);
  const lastToastRef = useRef({});

  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();

  const isAdminUser = String(profile.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const banUntilLocal = banUntilMs(profile.ban);
  const isBannedLocal = !!banUntilLocal && nowMs() < banUntilLocal;

  if (isBannedLocal && !isAdminUser) {
    const reason = profile?.ban?.reason || 'Причина не указана';
    const untilStr = new Date(banUntilLocal).toLocaleString();
    return (
      <div className="w-full h-full flex items-center justify-center bg-tgDark">
        <div className="w-[560px] max-w-[92vw] p-6 bg-tgPanel rounded-2xl border border-white/10">
          <div className="text-white font-bold text-2xl">Вы забанены</div>
          <div className="text-tgHint mt-2">До: <span className="text-white/90">{untilStr}</span></div>
          <div className="text-tgHint mt-1">Причина: <span className="text-white/90">{reason}</span></div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="px-4 py-3 rounded-xl bg-tgBlue hover:bg-blue-500 text-white font-bold"
              onClick={() => navigate(`/chat/bot_${SYSTEM_BOT_USERNAME}_${profile.uid}`)}
            >
              Открыть @{SYSTEM_BOT_USERNAME}
            </button>
            <button type="button" className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white" onClick={onLogout}>Выйти</button>
          </div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const onOpen = (e) => {
      const url = e?.detail?.url;
      if (url) setMiniAppUrl(url);
    };
    const onSendCmd = (e) => {
      const cmd = e?.detail?.command;
      if (cmd) setText(cmd);
    };
    const onAction = async (e) => {
      const act = e?.detail?.action;
      if (!act) return;
      if (act === 'security_not_me') {
        try {
          await updateDoc(doc(db, 'users', profile.uid), { securityFlag: true, securityFlagAt: serverTimestamp() });
        } catch {}
        try {
          await signOut(auth);
        } catch {}
      }
    };
    window.addEventListener('zantgrams:open-miniapp', onOpen);
        const onOpenCreateBot = () => setShowCreateBot(true);
    window.addEventListener('zantgrams:open-createbot', onOpenCreateBot);
    window.addEventListener('zantgrams:send-command', onSendCmd);
    window.addEventListener('zantgrams:action', onAction);
    return () => {
      window.removeEventListener('zantgrams:open-miniapp', onOpen);
            window.removeEventListener('zantgrams:open-createbot', onOpenCreateBot);
      window.removeEventListener('zantgrams:send-command', onSendCmd);
      window.removeEventListener('zantgrams:action', onAction);
    };
  }, []);

  const myUid = profile.uid;
  const isAdmin = String(profile.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const banUntil = banUntilMs(profile.ban);
  const isBanned = !!banUntil && nowMs() < banUntil;

  // System bot: login/security notifications
  useEffect(() => {
    if (!myUid) return;
    const chatId = `bot_${SYSTEM_BOT_USERNAME}_${myUid}`;
    (async () => {
      try {
        const ref = doc(db, 'chats', chatId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: chatId,
            type: 'bot',
            botUsername: SYSTEM_BOT_USERNAME,
            title: SYSTEM_BOT_USERNAME,
            description: 'Уведомления безопасности и системы',
            username: SYSTEM_BOT_USERNAME,
            visibility: 'private',
            ownerUid: myUid,
            admins: [myUid],
            members: [myUid],
            avatar_data_url: '',
            verified: true,
            createdAt: serverTimestamp(),
            lastActivityAt: serverTimestamp(),
          });
        }

        // send a login notice once per session
        const key = `zg_${myUid}_login_notice_${new Date().toDateString()}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          const ua = navigator.userAgent || 'Unknown device';
          await addDoc(collection(db, 'chats', chatId, 'messages'), {
            type: 'text',
            text: `Новый вход в аккаунт.\nУстройство: ${ua}`,
            sender_uid: myUid,
            sender_username: profile.username,
            sender_isBot: true,
            sender_badges: { verified: true },
            bot_name: 'ZanTGrams',
            bot_username: SYSTEM_BOT_USERNAME,
            bot_avatar_data_url: '',
            buttons: [
              { type: 'action', text: 'Это я', action: 'security_ok' },
              { type: 'action', text: 'Это не я', action: 'security_not_me' },
            ],
            createdAt: serverTimestamp(),
          });
          await updateDoc(ref, { lastActivityAt: serverTimestamp(), lastMessageText: 'Новый вход…' });
        }
      } catch (e) {
        console.warn('system bot setup failed', e);
      }
    })();
  }, [myUid]);

  const activeChatMeta = useMemo(() => {
    if (!activeChat?.id) return null;
    return chats.find((c) => c.id === activeChat.id) || activeChat;
  }, [activeChat, chats]);

  const needsCreatebotStart = activeChatMeta?.type === 'bot' && activeChatMeta?.botUsername === 'createbot' && (messages?.length || 0) === 0;

  const canSendToChat = useMemo(() => {
    if (!activeChatMeta) return false;
    if (activeChatMeta?.type !== 'channel') return true;
    const admins = activeChatMeta?.admins || [];
    return admins.includes(myUid);
  }, [activeChatMeta, myUid]);

  const iAmOwner = useMemo(() => {
    if (!activeChatMeta) return false;
    return activeChatMeta.ownerUid === myUid;
  }, [activeChatMeta, myUid]);

  // Chats list
  // 1) public chats (видны всем)
  // 2) member chats (лички/приватные группы/каналы) where members contains me
  useEffect(() => {
    // NOTE: avoid composite-index requirements by not using orderBy with where
    const qPublic = query(collection(db, 'chats'), where('visibility', '==', 'public'), limit(150));
    const unsubPublic = onSnapshot(qPublic, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (!data.deleted) arr.push({ id: d.id, ...data });
      });
      setChatsPublic(arr);
    });

    const qMember = query(collection(db, 'chats'), where('members', 'array-contains', myUid), limit(150));
    const unsubMember = onSnapshot(qMember, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (!data.deleted) arr.push({ id: d.id, ...data });
      });
      setChatsMember(arr);
    });

    return () => {
      unsubPublic();
      unsubMember();
    };
  }, [myUid]);

  // merge chats (unique by id) + global always pinned
  useEffect(() => {
    const map = new Map();
    for (const c of [...chatsPublic, ...chatsMember]) map.set(c.id, c);
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const ta = (a.lastActivityAt?.toMillis ? a.lastActivityAt.toMillis() : 0) || (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
      const tb = (b.lastActivityAt?.toMillis ? b.lastActivityAt.toMillis() : 0) || (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
      return tb - ta;
    });
    setChats(arr);
  }, [chatsPublic, chatsMember]);

  // In-app notifications while the site is open
  useEffect(() => {
    const prev = lastToastRef.current || {};
    for (const c of chats) {
      const lm = c.lastMessageAt?.toMillis ? c.lastMessageAt.toMillis() : 0;
      if (!lm) continue;
      const prevLm = prev[c.id] || 0;
      if (lm > prevLm && c.id !== activeChat?.id) {
        const title = c.title || c.username || c.id;
        const text = c.lastMessageText || 'Новое сообщение';
        setToast({ chatId: c.id, title, text });
        setTimeout(() => setToast(null), 4500);
      }
      prev[c.id] = lm;
    }
    lastToastRef.current = prev;
  }, [chats, activeChat?.id]);

  // pick first chat if none selected
  useEffect(() => {
    if (!activeChat && chats.length) {
      const c = chats[0];
      setActiveChat({ id: c.id, type: c.type, title: c.title || c.name || c.username || c.id });
    }
  }, [activeChat, chats]);

  // Messages
  useEffect(() => {
    if (!activeChat?.id) {
      setMessages([]);
      return;
    }
    const msgsRef = collection(db, 'chats', activeChat.id, 'messages');
    const qMsgs = query(msgsRef, orderBy('createdAt', 'asc'), limit(500));

    const unsub = onSnapshot(
      qMsgs,
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
        setMessages(arr);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      },
      (err) => {
        console.error(err);
      }
    );

    return () => unsub();
  }, [activeChat?.id]);

  // User search
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const term = searchTerm.trim().toLowerCase();
      const t2 = term.replace(/^@+/, '');
      if (!term) {
        setSearchResults([]);
        return;
      }
      const qUsers = query(collection(db, 'users'), orderBy('username'), limit(80));
      const snap = await getDocs(qUsers);
      if (cancelled) return;

      const arr = [];
      snap.forEach((d) => {
        const u = d.data();
        const uname = String(u?.username || '').toLowerCase();
        const mail = String(u?.email || '').toLowerCase();
        if (u?.uid !== myUid && (uname.includes(t2) || mail.includes(t2))) {
          arr.push(u);
        }
      });
      setSearchResults(arr.slice(0, 20));
    };

    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchTerm, myUid]);

  // Open chat from routes (/c/:username, /chat/:id) + legacy query (?c= / ?chat=)
  useEffect(() => {
    const run = async () => {
      let id = null;
      let byUsername = null;

      if (routeTarget?.type === 'chatId') id = routeTarget.value;
      if (routeTarget?.type === 'chatUsername') byUsername = routeTarget.value;

      // legacy support
      if (!id && !byUsername) {
        const url = new URL(window.location.href);
        id = url.searchParams.get('chat');
        byUsername = url.searchParams.get('c');
      }

      if (!id && byUsername) {
        const q = query(collection(db, 'chats'), where('username', '==', String(byUsername).toLowerCase()), limit(1));
        const s = await getDocs(q);
        const doc0 = s.docs[0];
        if (doc0) id = doc0.id;
      }
      if (!id) return;

      const chatRef = doc(db, 'chats', id);
      const snap = await getDoc(chatRef);
      if (!snap.exists()) return;
      const data = snap.data();

      const members = Array.isArray(data.members) ? data.members : [];
      if (!members.includes(myUid) && id !== GLOBAL_CHAT_ID && data.visibility === 'public') {
        await updateDoc(chatRef, { members: [...members, myUid] });
      }

      setActiveChat({
        id,
        type: data.type,
        title: data.title || data.name || id,
        username: data.username || data.botUsername || '',
        members: data.members || [],
        mate_uid: data.mate_uid || null,
        avatar_data_url: data.avatar_data_url || '',
        avatar_emoji: data.avatar_emoji || '',
        verified: !!data.verified,
      });
    };

    run().catch(() => {});
  }, [myUid, routeTarget]);

  const sendMessage = async (payload) => {
    if (!activeChat?.id) return;

    // image-only chat
    if (activeChat.type === 'images' && payload?.type !== 'image') {
      alert('Этот чат только для изображений.');
      return;
    }

    // block checks for private chats
    if (activeChat.type === 'private') {
      const members = activeChat.members || [];
      const otherUid = activeChat.mate_uid || members.find((x) => x && x !== myUid);
      if (otherUid) {
        const iBlocked = await getDoc(doc(db, 'users', myUid, 'blocked', otherUid));
        if (iBlocked.exists()) {
          alert('Вы заблокировали этого пользователя. Разблокируйте, чтобы писать.');
          return;
        }
        const theyBlocked = await getDoc(doc(db, 'users', otherUid, 'blocked', myUid));
        if (theyBlocked.exists()) {
          const data = theyBlocked.data() || {};
          const who = data.byUsername ? `@${data.byUsername}` : 'пользователь';
          alert(`Вы заблокированы. Вас заблокировал ${who}.`);
          return;
        }
      }
    }

    // post as channel: render from channel identity
    const asChannel = activeChat.type === 'channel';
    const msgsRef = collection(db, 'chats', activeChat.id, 'messages');
    await addDoc(msgsRef, {
      ...payload,
      sender_uid: myUid,
      sender_username: asChannel ? (activeChat.username || activeChat.title || 'channel') : profile.username,
      sender_avatar_data_url: asChannel ? (activeChat.avatar_data_url || '') : (profile.avatar_data_url || ''),
      sender_avatar_emoji: asChannel ? (activeChat.avatar_emoji || '') : (profile.avatar_emoji || ''),
      sender_badges: asChannel ? ({ ...(profile.badges || {}), verified: true }) : (profile.badges || {}),
      sender_as: asChannel ? 'channel' : 'user',
      sender_channel_id: asChannel ? activeChat.id : null,
      createdAt: serverTimestamp(),
    });

    // bump chat activity so it appears in the list
    try {
      const chatRef = doc(db, 'chats', activeChat.id);
      await updateDoc(chatRef, {
        lastActivityAt: serverTimestamp(),
        lastMessageText:
          payload?.type === 'image' ? '📷 Фото' : payload?.type === 'post' ? '📰 Пост' : String(payload?.text || '').slice(0, 120),
        lastMessageAt: serverTimestamp(),
        lastMessageSenderUsername: asChannel ? (activeChat.username || activeChat.title || 'channel') : profile.username,
      });
    } catch {
      // ignore
    }
  };
  const REACTION_EMOJIS = ['👍','❤️','😂','🔥','😮','😢','👎','🎉'];
  const [reactionTarget, setReactionTarget] = useState(null);

  const toggleReaction = async (chatId, msgId, emoji) => {
    const ref = doc(db, 'chats', chatId, 'messages', msgId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const reactions = data.reactions || {};
      const users = reactions[emoji] || {};
      const nextUsers = { ...users };
      if (nextUsers[myUid]) delete nextUsers[myUid];
      else nextUsers[myUid] = true;

      const nextReactions = { ...reactions, [emoji]: nextUsers };
      tx.update(ref, { reactions: nextReactions });
    });
  };

  
const canPinInChat = useMemo(() => {
  if (!activeChatMeta) return false;
  if (activeChatMeta.type !== 'group' && activeChatMeta.type !== 'channel') return false;
  const admins = activeChatMeta.admins || [];
  return isAdmin || iAmOwner || admins.includes(myUid);
}, [activeChatMeta, isAdmin, iAmOwner, myUid]);

const pinPhotoMessage = async (msg) => {
  if (!activeChat?.id || !msg?.id) return;
  if (!canPinInChat) return;
  const img = msg.image_data_url || '';
  if (!img) return;
  const pinned = {
    messageId: msg.id,
    type: msg.type || 'image',
    image_data_url: img,
    text: msg.text || '',
    title: activeChatMeta?.title || activeChatMeta?.name || activeChat?.title || '',
    pinnedBy: myUid,
    pinnedAt: serverTimestamp(),
  };
  await updateDoc(doc(db, 'chats', activeChat.id), { pinned });
};

const unpinMessage = async () => {
  if (!activeChat?.id) return;
  if (!canPinInChat) return;
  await updateDoc(doc(db, 'chats', activeChat.id), { pinned: null });
};

const jumpToPinned = () => {
  const mid = activeChatMeta?.pinned?.messageId;
  if (!mid) return;
  const el = document.getElementById(`msg_${mid}`);
  if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const handleReact = async (msg, action) => {
    if (!activeChat?.id || !msg?.id) return;
    if (action === 'picker') {
      setReactionTarget(msg);
      return;
    }
    await toggleReaction(activeChat.id, msg.id, action);
  };



  // Client-only bots: write messages as the current user (for rules), but render as bot.
  const sendBotMessage = async ({ chatId, botName, botUsername, botAvatar, text: tText, buttons = [] }) => {
    if (!chatId) return;
    const msgsRef = collection(db, 'chats', chatId, 'messages');
    await addDoc(msgsRef, {
      type: 'text',
      text: tText || '',
      buttons,
      sender_uid: myUid,
      sender_username: profile.username,
      sender_avatar_data_url: '',
      sender_badges: { verified: true },
      sender_isBot: true,
      bot_name: botName || 'Bot',
      bot_username: botUsername || '',
      bot_avatar_data_url: botAvatar || '',
      createdAt: serverTimestamp(),
    });
  };

  const handleSendText = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (!canSendToChat) return;

    await sendMessage({ type: 'text', text: t });
    setText('');

    // Bot-like behavior
    try {
      if (activeChatMeta?.type === 'bot' && activeChatMeta?.botUsername === 'createbot') {
        if (t === '/start' || t.toLowerCase() === 'start') {
          await sendBotMessage({
            chatId: activeChatMeta?.id || getCreatebotChatId(myUid),
            botName: 'CreateBot',
            botUsername: 'createbot',
            botAvatar: '',
            text: 'Привет! При создании своего бота нажми кнопку Open.',
            buttons: [{ type: 'open', text: 'Open', url: 'zantgrams:createbot' }],
          });
        } else {
          await sendBotMessage({
            chatId: activeChatMeta?.id || getCreatebotChatId(myUid),
            botName: 'CreateBot',
            botUsername: 'createbot',
            botAvatar: '',
            text: 'Нажми /start чтобы начать. Потом нажми Open для создания бота.',
            buttons: [{ type: 'send', text: 'Start', command: '/start' }],
          });
        }
        return;
      }

      if (activeChatMeta?.type === 'bot' && activeChatMeta?.botId && t.startsWith('/')) {
        const cmdName = t.slice(1).trim().split(' ')[0].toLowerCase();
        const cmdRef = doc(db, 'bots', activeChatMeta.botId, 'commands', cmdName);
        const cmdSnap = await getDoc(cmdRef);
        if (cmdSnap.exists()) {
          const c = cmdSnap.data() || {};
          await sendBotMessage({
            chatId: activeChatMeta.id,
            botName: activeChatMeta.title,
            botUsername: activeChatMeta.username || '',
            botAvatar: activeChatMeta.avatar_data_url || '',
            text: c.text || '',
            buttons: Array.isArray(c.buttons) ? c.buttons : [],
          });
        } else if (cmdName === 'start') {
          await sendBotMessage({
            chatId: activeChatMeta.id,
            botName: activeChatMeta.title,
            botUsername: activeChatMeta.username || '',
            botAvatar: activeChatMeta.avatar_data_url || '',
            text: `Привет! Это бот @${activeChatMeta.username || ''}.`,
            buttons: activeChatMeta.webAppUrl ? [{ type: 'open', text: 'Open', url: activeChatMeta.webAppUrl }] : [],
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canSendToChat) return;

    try {
      // Без Storage: сохраняем картинку в Firestore как dataURL.
      // Подбираем параметры, чтобы влезть в лимит документа.
      const dataUrl = await imageFileToDataUrlUnderLimit(file, { limitChars: 780_000 });
      await sendMessage({ type: 'image', text: '', image_data_url: dataUrl });
    } catch (err) {
      console.error(err);
      if (String(err?.message || err) === 'IMAGE_TOO_LARGE') {
        alert('Картинка слишком большая. Попробуй меньшее разрешение/вес.');
      } else {
        alert(`Не удалось отправить картинку: ${err?.code || ''} ${err?.message || err}`);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const joinPublicChat = async (chat) => {
    const chatRef = doc(db, 'chats', chat.id);
    const snap = await getDoc(chatRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const members = Array.isArray(data.members) ? data.members : [];
    if (!members.includes(myUid) && chat.id !== GLOBAL_CHAT_ID) {
      await updateDoc(chatRef, { members: [...members, myUid] });
    }
    setActiveChat({ id: chat.id, type: chat.type, title: chat.title || chat.name });

    if (chat.id === GLOBAL_CHAT_ID) {
      navigate('/');
    } else if (chat.username) {
      navigate(`/c/${chat.username}`);
    } else {
      navigate(`/chat/${chat.id}`);
    }
  };

  const openPrivateChat = async (mate) => {
    // private chat id = deterministic
    const chatId = [myUid, mate.uid].sort().join('__');
    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        id: chatId,
        type: 'private',
        title: '',
        description: '',
        username: '',
        visibility: 'private',
        ownerUid: myUid,
        admins: [myUid],
        members: [myUid, mate.uid],
        avatar_data_url: '',
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        titleByUid: { [myUid]: mate.username, [mate.uid]: profile.username },
      });
    } else {
      // backfill titleByUid for older chats
      const data = chatSnap.data() || {};
      if (!data.titleByUid) {
        await updateDoc(chatRef, { titleByUid: { [myUid]: mate.username, [mate.uid]: profile.username } });
      }
    }

    setActiveChat({ id: chatId, type: 'private', title: mate.username });
    navigate(`/chat/${chatId}`);
    setSearchTerm('');
    setSearchResults([]);
  };

  const copyInviteLink = async () => {
  const c = activeChatMeta;
  if (!c?.id) return;
  const origin = window.location.origin;

  try {
    let url = '';

    if (c.visibility === 'private') {
      const admins = c.admins || [];
      const canSee = iAmOwner || isAdmin || admins.includes(myUid);
      if (!canSee) {
        alert('Это приватный канал/группа. Ссылка доступна только владельцу и админам.');
        return;
      }

      // stable invite link
      const ref = doc(db, 'chats', c.id);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : c;
      let code = data?.inviteCode;
      if (!code) {
        code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
        await updateDoc(ref, { inviteCode: code });
      }
      url = `${origin}/invite/${code}`;
    } else {
      url = c.username ? `${origin}/c/${c.username}` : `${origin}/chat/${c.id}`;
    }

    await navigator.clipboard.writeText(url);
    alert('Ссылка скопирована!');
  } catch (e) {
    console.error(e);
    const origin = window.location.origin;
    const c = activeChatMeta;
    const fallback = c?.username ? `${origin}/c/${c.username}` : `${origin}/chat/${c?.id}`;
    prompt('Скопируй ссылку:', fallback);
  }
};

  // Admin-only: delete ALL messages in the current chat (keeps the chat itself)
  const clearChatMessages = async () => {
    const c = activeChatMeta;
    if (!c?.id) return;
    if (!isAdmin) {
      alert('Недостаточно прав');
      return;
    }
    if (!confirm('Удалить ВСЕ сообщения в этом чате?')) return;

    try {
      const msgsCol = collection(db, 'chats', c.id, 'messages');
      // delete in batches of 450-500
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const snap = await getDocs(query(msgsCol, limit(450)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await updateDoc(doc(db, 'chats', c.id), {
        lastMessageText: '',
        lastMessageAt: null,
        lastActivityAt: serverTimestamp(),
        pinned: null,
      });
      setMessages([]);
      alert('Чат очищен.');
    } catch (e) {
      console.error(e);
      alert('Не удалось очистить чат. Проверь Rules Firestore.');
    }
  };

  return (
    <div className="h-full w-full flex">
      {toast && (
        <button
          type="button"
          className="fixed top-4 right-4 z-[95] max-w-[360px] w-[92vw] sm:w-[360px] text-left bg-tgPanel border border-white/10 rounded-2xl shadow-2xl p-4 hover:border-white/20"
          onClick={() => {
            setToast(null);
            navigate(`/chat/${toast.chatId}`);
          }}
        >
          <div className="text-white font-semibold truncate">{toast.title}</div>
          <div className="text-xs text-white/60 mt-1 truncate">{toast.text}</div>
          <div className="text-[11px] text-[#4ea1ff] mt-2">Открыть</div>
        </button>
      )}
      {/* Sidebar */}
      <div className="w-80 bg-tgPanel flex flex-col border-r border-black/20 z-20 shadow-xl">
        <div className="p-4 border-b border-black/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="w-10 h-10 rounded-xl bg-tgDark border border-white/10 text-white/80 hover:text-white hover:bg-white/5"
                title="Меню"
                onClick={() => setShowHamburger(true)}
              >
                ☰
              </button>

              <AvatarCircle dataUrl={profile.avatar_data_url} emoji={profile.avatar_emoji} fallback={profile.username} />
              <div className="leading-tight">
                <div className="text-white font-bold flex items-center gap-2">
                  <span>{profile.username}</span>
                  <BadgesInline badges={profile.badges || {}} onBadgeClick={(k) => setBadgeInfo(k)} />
                </div>
                <div className="text-tgHint text-xs">@{profile.username || ''}</div>
              </div>
            </div>

            <button
              className="text-tgHint hover:text-white transition"
              title="Настройки"
              onClick={() => setShowSettings(true)}
            >
              ⚙️
            </button>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 py-2 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold text-sm"
              onClick={() => setShowCreate(true)}
            >
              + Группа/Канал
            </button>
            {isAdmin && (
              <button
                className="px-3 py-2 rounded bg-white/10 hover:bg-white/15 text-white font-bold text-sm"
                onClick={() => navigate('/admin')}
                title="Админка"
                type="button"
              >
                🛠
              </button>
            )}
            <button
              className="px-3 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
              onClick={onLogout}
              title="Выйти"
            >
              ⎋
            </button>
          </div>

          <div className="mt-3">
            <input
              className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
              placeholder="Поиск пользователей для личного чата…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {searchResults.length > 0 && (
            <div className="mt-2 bg-tgDark rounded border border-white/10 overflow-hidden">
              {searchResults.map((u) => (
                <button
                  key={u.uid}
                  onClick={() => openPrivateChat(u)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left"
                >
                  <AvatarCircle dataUrl={u.avatar_data_url} emoji={u.avatar_emoji} fallback={u.username} small />
                  <div className="min-w-0">
                    <div className="text-white text-sm font-semibold truncate flex items-center gap-2">
                      <span>{u.username}</span>
                      <span className="text-xs">{badgeText(u)}</span>
                    </div>
                    <div className="text-tgHint text-xs truncate">@{u.username || ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <SectionTitle title="Чаты" />

          {chats.length === 0 ? (
            <div className="px-4 py-8 text-tgHint text-sm">
              Чтобы начать общаться найдите своих друзей по <span className="text-white">@username</span>!
            </div>
          ) : (
            chats.map((c) => {
              const isMine = Array.isArray(c.members) ? c.members.includes(myUid) : false;
              const isPublic = c.visibility === 'public';
              const subtitle = c.type === 'channel' ? 'Канал' : c.type === 'group' ? 'Группа' : c.type;
              const title = c.type === 'private' ? (c.titleByUid?.[myUid] || c.title || c.name || c.id) : (c.title || c.name || c.id);

              return (
                <ChatItem
                  key={c.id}
                  active={activeChat?.id === c.id}
                  title={title}
                  subtitle={`${subtitle}${isPublic ? (isMine ? ' • вы участник' : ' • нажмите чтобы вступить') : ''}`}
                  onClick={() => {
                    if (isPublic) return joinPublicChat(c);
                    setActiveChat({ id: c.id, type: c.type, title: c.title || c.name });
                    if (c.username) navigate(`/c/${c.username}`);
                    else navigate(`/chat/${c.id}`);
                  }}
                  icon={c.type === 'channel' ? '📣' : c.type === 'group' ? '👥' : c.type === 'bot' ? '🤖' : '💬'}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        <div className="h-16 bg-tgPanel flex items-center px-6 shadow border-b border-black/10 z-10 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-lg flex items-center gap-2 truncate">
              {activeChatMeta?.type === 'channel' ? '📣' : activeChatMeta?.type === 'group' ? '👥' : activeChatMeta?.type === 'private' ? '💬' : activeChatMeta?.type === 'bot' ? '🤖' : '#'}
              <span className="truncate">
                {activeChatMeta?.type === 'private'
                  ? (activeChatMeta?.titleByUid?.[myUid] || activeChatMeta?.title || activeChatMeta?.name || activeChat?.title)
                  : (activeChatMeta?.title || activeChatMeta?.name || activeChat?.title)}
              </span>
              {(activeChatMeta?.verified && (activeChatMeta?.type === 'channel' || activeChatMeta?.type === 'group')) && <ChatVerifiedBadge />}
            </div>
            <div className="text-tgHint text-xs flex items-center gap-2">
              {activeChatMeta?.type === 'channel'
                ? canSendToChat
                  ? 'Канал • вы админ (можете писать)'
                  : 'Канал • только админы могут писать'
                : activeChatMeta?.type === 'private'
                  ? 'Личный чат'
                  : activeChatMeta?.type === 'group'
                    ? 'Группа'
                    : 'Публичный чат'}{activeChatMeta && (
                <>
                  <span className="opacity-60">•</span>
                  <button className="hover:text-white" type="button" onClick={copyInviteLink} title="Скопировать ссылку">
                    🔗 ссылка
                  </button>
                  {isAdmin && (
                    <>
                      <span className="opacity-60">•</span>
                      <button className="hover:text-white" type="button" onClick={clearChatMessages} title="Очистить чат">
                        🧹 очистить
                      </button>
                    </>
                  )}
                </>
              )}
              {activeChatMeta?.type === 'bot' && activeChatMeta?.botUsername === 'createbot' && (
                <>
                  <span className="opacity-60">•</span>
                  <button className="hover:text-white" type="button" onClick={() => setShowCreateBot(true)} title="Создать бота">
                    ＋ Create bot
                  </button>
                </>
              )}
              {activeChatMeta?.type === 'bot' && activeChatMeta?.webAppUrl && (
                <>
                  <span className="opacity-60">•</span>
                  <button className="hover:text-white" type="button" onClick={() => setMiniAppUrl(activeChatMeta.webAppUrl)} title="Открыть mini app">
                    Open
                  </button>
                </>
              )}

              {canSendToChat && activeChatMeta?.type !== 'private' && (
                <>
                  <span className="opacity-60">•</span>
                  <button className="hover:text-white" type="button" onClick={() => setShowPostComposer(true)} title="Новый пост">
                    ＋ пост
                  </button>
                </>
              )}
              {(activeChatMeta?.type === 'group' || activeChatMeta?.type === 'channel') && (iAmOwner || isAdmin || (activeChatMeta?.admins || []).includes(myUid)) && (
                <>
                  <span className="opacity-60">•</span>
                  <button className="hover:text-white" type="button" onClick={() => setShowChatSettings(true)} title="Настройки чата">
                    ✏️ управление
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {activeChatMeta?.pinned?.messageId && (
          <PinnedBanner
            pinned={activeChatMeta.pinned}
            onJump={jumpToPinned}
            canUnpin={canPinInChat}
            onUnpin={unpinMessage}
          />
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {messages.map((m) => (
            <div key={m.id} id={`msg_${m.id}`}>
              <MessageBubble
                me={myUid}
                msg={m}
                onOpenImage={setViewImage}
                onOpenPost={(post) => setViewPost({ ...post, chatId: activeChat?.id })}
                onReact={handleReact}
                onBadgeClick={(k) => setBadgeInfo(k)}
                canPin={canPinInChat}
                onPin={pinPhotoMessage}
              />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSendText} className="p-4 bg-tgPanel border-t border-black/20 flex items-center gap-3">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`p-3 transition rounded-full ${canSendToChat ? 'text-tgHint hover:text-white' : 'opacity-40 cursor-not-allowed'}`}
            title="Отправить картинку"
            disabled={!canSendToChat}
          >
            📎
          </button>

          {activeChatMeta?.type === 'bot' && activeChatMeta?.webAppUrl && (
            <button
              type="button"
              onClick={() => setMiniAppUrl(activeChatMeta.webAppUrl)}
              className="px-4 py-2 rounded-full bg-tgBlue hover:bg-blue-500 text-white font-bold"
              title="Open"
            >
              Open
            </button>
          )}

          {needsCreatebotStart ? (
            <button
              type="button"
              className="flex-1 py-3 rounded-full font-bold text-white bg-tgBlue hover:bg-blue-500"
              onClick={async () => {
                // send /start from user
                await sendMessage({ type: 'text', text: '/start' });
                try {
                  const key = `zg_${profile.uid}_createbot_started`;
                  localStorage.setItem(key, '1');
                } catch {}
                setCreatebotStarted(true);
                setText('');
                // trigger bot response
                await sendBotMessage({
                  chatId: activeChatMeta?.id || '',
                  botName: 'CreateBot',
                  botUsername: 'createbot',
                  botAvatar: '',
                  text: 'Привет! При создании своего бота нажми кнопку Open.',
                  buttons: [{ type: 'open', text: 'Open', url: 'zantgrams:createbot' }],
                });
              }}
            >
              Start
            </button>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canSendToChat) handleSendText(e);
                  }
                }}
                rows={1}
                placeholder={canSendToChat ? 'Сообщение… (Shift+Enter — новая строка)' : 'В этом канале писать могут только админы'}
                className="flex-1 p-3 rounded-2xl bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white resize-none leading-5 max-h-36"
                disabled={!canSendToChat}
              />

              <button
                type="submit"
                className={`px-5 py-3 rounded-full font-bold text-white transition ${
                  canSendToChat ? 'bg-tgBlue hover:bg-blue-500' : 'bg-tgBlue/40 cursor-not-allowed'
                }`}
                disabled={!canSendToChat}
              >
                ➤
              </button>
            </>
          )}
        </form>
      </div>

      {showCreate && (
        <CreateChatModal
          myUid={myUid}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setActiveChat({ id: c.id, type: c.type, title: c.title });
            if (c.username) navigate(`/c/${c.username}`);
            else navigate(`/chat/${c.id}`);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          meUid={myUid}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setShowSettings(false)}
          onProfileUpdated={(p) => setProfile(p)}
        />
      )}

      {showHamburger && (
        <HamburgerMenu
          me={profile}
          isAdmin={isAdmin}
          onClose={() => setShowHamburger(false)}
          onOpenSettings={() => { setShowHamburger(false); setShowSettings(true); }}
          onOpenAdmin={() => { setShowHamburger(false); navigate('/admin'); }}
          onCreateGroup={() => { setShowHamburger(false); setShowCreate(true); }}
        />
      )}

      {showChatSettings && (
        <ChatSettingsModal
          chat={activeChatMeta}
          myUid={myUid}
          onClose={() => setShowChatSettings(false)}
        />
      )}

{showPostComposer && (
  <PostComposerModal
    me={profile}
    chat={activeChatMeta}
    canPost={canSendToChat}
    onClose={() => setShowPostComposer(false)}
    onSend={async ({ text: pText, imageDataUrl }) => {
      if (!canSendToChat) return;
      await sendMessage({ type: 'post', text: pText || '', image_data_url: imageDataUrl || '', views: 0 });
    }}
  />
)}

{viewImage && <ImageViewerModal src={viewImage} onClose={() => setViewImage(null)} />}


{reactionTarget && (
  <ReactionPickerModal
    onPick={async (emoji) => {
      await handleReact(reactionTarget, emoji);
      setReactionTarget(null);
    }}
    onClose={() => setReactionTarget(null)}
  />
)}

{viewPost && (
  <PostViewerModal
    post={viewPost}
    onClose={() => setViewPost(null)}
    onOpenImage={(src) => setViewImage(src)}
    onBadgeClick={(k) => setBadgeInfo(k)}
  />
)}


{showCreateBot && (
  <CreateBotModal
    ownerUid={myUid}
    onClose={() => setShowCreateBot(false)}
    onCreated={(info) => {
      // after create, open bot chat
      if (info?.id) {
        setActiveChat({ id: info.id, type: 'bot', title: info.username });
        navigate(`/chat/${info.id}`);
      }
    }}
  />
)}

{miniAppUrl && <MiniAppModal url={miniAppUrl} onClose={() => setMiniAppUrl(null)} />}
{badgeInfo && <BadgeInfoModal kind={badgeInfo} onClose={() => setBadgeInfo(null)} />}


    </div>
  );
}

function SectionTitle({ title }) {
  return <div className="px-4 pt-4 pb-2 text-tgHint text-xs uppercase tracking-wider">{title}</div>;
}

function EmojiAvatarPicker({ value, onPick, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onMouseDown={onClose}>
      <div
        className="w-[460px] max-w-[92vw] max-h-[82vh] overflow-auto bg-tgPanel border border-white/10 rounded-2xl shadow-2xl p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-white font-bold">Выбери эмодзи-аватар</div>
          <button className="text-tgHint hover:text-white" onClick={onClose} type="button">✕</button>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-2">
          {EMOJI_AVATARS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className={`h-12 w-12 rounded-xl border flex items-center justify-center text-2xl transition ${
                value === e ? 'bg-white/10 border-white/20' : 'bg-tgDark border-white/10 hover:bg-white/5'
              }`}
              title={e}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs text-tgHint">Если не хочешь загружать фото — выбери эмодзи.</div>
      </div>
    </div>
  );
}

function HamburgerMenu({ me, isAdmin, onClose, onOpenSettings, onOpenAdmin, onCreateGroup }) {
  const navigate = useNavigate();
  const copy = async () => {
    const origin = window.location.origin;
    const link = me?.username ? `${origin}/u/${me.username}` : `${origin}/id/${me?.uid}`;
    try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
    alert('Ссылка на профиль скопирована');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50" onMouseDown={onClose}>
      <div
        className="w-[320px] max-w-[90vw] h-full bg-tgPanel border-r border-white/10 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-black/20">
          <div className="flex items-center gap-3">
            <AvatarCircle dataUrl={me.avatar_data_url} emoji={me.avatar_emoji} fallback={me.username} />
            <div className="min-w-0">
              <div className="text-white font-bold truncate flex items-center gap-2">
                <span className="truncate">{me.displayName || me.username}</span>
                <BadgesInline badges={me.badges || {}} />
              </div>
              <div className="text-tgHint text-xs truncate">@{me.username}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={copy} className="flex-1 px-3 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white">🔗 профиль</button>
            <button type="button" onClick={onClose} className="px-3 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white">✕</button>
          </div>
        </div>

        <div className="p-2">
          <MenuItem icon="👤" label="Мой профиль" onClick={() => { onClose(); navigate(`/u/${me.username}`); }} />
          <MenuItem icon="⭐" label={`Кошелёк / Звёзды`} onClick={() => { onClose(); navigate('/wallet'); }} />
          <MenuItem icon="👥" label="Создать группу / канал" onClick={onCreateGroup} />
          <MenuItem icon="⚙️" label="Настройки" onClick={onOpenSettings} />
          <MenuItem icon="🔒" label="Конфиденциальность" onClick={() => { onClose(); navigate('/privacy'); }} />
          <MenuItem icon="📄" label="Условия" onClick={() => { onClose(); navigate('/terms'); }} />
          <MenuItem icon="🍪" label="Cookies" onClick={() => { onClose(); navigate('/cookies'); }} />
          {isAdmin && <MenuItem icon="🛠" label="Админка" onClick={onOpenAdmin} />}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-tgDark border border-white/10 flex items-center justify-center">{icon}</div>
      <div className="text-white/90 font-semibold">{label}</div>
    </button>
  );
}

function AvatarCircle({ dataUrl, emoji, fallback, small }) {
  const size = small ? 'w-9 h-9' : 'w-11 h-11';
  return (
    <div className={`${size} rounded-full bg-tgDark overflow-hidden border border-white/10 flex items-center justify-center`}
    >
      {dataUrl ? (
        <img src={dataUrl} className="w-full h-full object-cover" alt="avatar" />
      ) : emoji ? (
        <div className={small ? 'text-lg' : 'text-xl'}>{emoji}</div>
      ) : (
        <div className="text-white/90">
          <DefaultAvatarSvg />
        </div>
      )}
    </div>
  );
}

function ChatItem({ active, title, subtitle, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-black/10 hover:bg-white/5 transition ${
        active ? 'bg-white/5' : ''
      }`}
    >
      <div className="w-11 h-11 bg-tgDark rounded-full flex items-center justify-center text-xl text-white font-bold shadow-sm border border-white/10">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-semibold truncate">{title}</div>
        <div className="text-tgHint text-xs truncate">{subtitle}</div>
      </div>
    </button>
  );
}

function MessageBubble({ me, msg, onOpenImage, onOpenPost, onReact, onBadgeClick, canPin, onPin }) {
  const mine = msg.sender_uid === me && !msg.sender_isBot;
  const badges = msg.sender_badges || {};
  const senderLabel = msg.sender_isBot ? (msg.bot_username ? `@${msg.bot_username}` : msg.bot_name || 'Bot') : (msg.sender_username || 'User');

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 relative shadow-sm text-base border border-white/10 ${
          mine ? 'bg-tgBlue text-white' : 'bg-tgPanel text-tgText'
        }`}
      >
{canPin && ((msg.type === 'image' && !!msg.image_data_url) || (msg.type === 'post' && !!msg.image_data_url)) && (
  <button
    type="button"
    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition px-2 py-1 rounded-full bg-black/20 hover:bg-black/30 text-white text-xs"
    title="Закрепить"
    onClick={() => onPin?.(msg)}
  >
    📌
  </button>
)}
        {!mine && (
          <div className="text-xs text-white/80 font-semibold mb-1 flex items-center gap-2">
            <a
              href={msg.sender_isBot ? '#' : `/u/${safeSlug(msg.sender_username || '')}`}
              className="hover:underline"
              title="Открыть профиль"
              onClick={(e) => {
                if (msg.sender_isBot || !msg.sender_username) {
                  e.preventDefault();
                  return;
                }
              }}
            >
              {senderLabel}
            </a>
            <BadgesInline badges={badges} onBadgeClick={onBadgeClick} />
          </div>
        )}

        {msg.type === 'text' && <div className="whitespace-pre-wrap break-words">{msg.text}</div>}

        {msg.type === 'post' && (
          <button
            type="button"
            className={`w-full text-left rounded-xl p-3 border border-white/10 ${mine ? 'bg-white/10' : 'bg-black/10'} hover:bg-white/5 transition`}
            onClick={() => onOpenPost?.(msg)}
          >
            <div className="flex items-center gap-3">
              <AvatarCircle dataUrl={msg.sender_avatar_data_url} emoji={msg.sender_avatar_emoji} fallback={msg.sender_username} small />
              <div className="min-w-0">
                <div className="text-sm font-bold flex items-center gap-2 truncate">
                  <span className="truncate">{msg.sender_username || 'User'}</span>
                  <BadgesInline badges={badges} onBadgeClick={onBadgeClick} />
                </div>
                <div className="text-[11px] text-white/70">{prettyTime(msg.createdAt)}</div>
              </div>
              <div className="ml-auto text-[11px] text-white/70">👁 {Number(msg.views || 0)}</div>
            </div>

            {msg.text && <div className="mt-2 whitespace-pre-wrap break-words">{msg.text}</div>}

            {msg.image_data_url && (
              <img
                src={msg.image_data_url}
                className="mt-3 rounded-xl max-h-96 object-cover w-full"
                alt="post"
                loading="lazy"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenImage?.(msg.image_data_url);
                }}
              />
            )}
          </button>
        )}

        {msg.type === 'image' && msg.image_data_url && (
          <img
            src={msg.image_data_url}
            className="rounded-xl max-h-80 object-cover w-full cursor-zoom-in"
            alt="image"
            loading="lazy"
            onClick={() => onOpenImage?.(msg.image_data_url)}
            onError={(e) => {
              // В редких случаях браузер может не принять большой dataURL — покажем заглушку.
              e.currentTarget.style.display = 'none';
            }}
          />
        )}

        {msg.type === 'image' && !msg.image_data_url && (
          <div className="text-sm text-white/80">[картинка не загрузилась]</div>
        )}

        {Array.isArray(msg.buttons) && msg.buttons.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {msg.buttons.map((b, idx) => (
              <button
                key={idx}
                type="button"
                className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
                onClick={() => {
                  if (b.type === 'open' && b.url) {
                  if (String(b.url).startsWith('zantgrams:createbot')) window.dispatchEvent(new CustomEvent('zantgrams:open-createbot'));
                  else window.dispatchEvent(new CustomEvent('zantgrams:open-miniapp', { detail: { url: b.url } }));
                }
                  if (b.type === 'send' && b.command) window.dispatchEvent(new CustomEvent('zantgrams:send-command', { detail: { command: b.command } }));
                  if (b.type === 'action' && b.action) window.dispatchEvent(new CustomEvent('zantgrams:action', { detail: { action: b.action } }));
                }}
              >
                {b.text || 'Open'}
              </button>
            ))}
          </div>
        )}

        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(msg.reactions).map(([emoji, users]) => {
              const count = users ? Object.keys(users).length : 0;
              if (!count) return null;
              const active = !!(users && users[me]);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact?.(msg, emoji)}
                  className={`px-2 py-1 rounded-full text-xs border border-white/10 ${active ? 'bg-white/15' : 'bg-black/10 hover:bg-white/10'}`}
                >
                  {emoji} {count}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onReact?.(msg, 'picker')}
              className="px-2 py-1 rounded-full text-xs border border-white/10 bg-black/10 hover:bg-white/10"
              title="Добавить реакцию"
            >
              ＋
            </button>
          </div>
        )}

        {!msg.reactions && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onReact?.(msg, 'picker')}
              className="px-2 py-1 rounded-full text-xs border border-white/10 bg-black/10 hover:bg-white/10"
              title="Реакции"
            >
              😊
            </button>
          </div>
        )}

        <div className={`text-[11px] mt-1 ${mine ? 'text-white/70' : 'text-tgHint'}`}>{prettyTime(msg.createdAt)}</div>
      </div>
    </div>
  );
}


function PinnedBanner({ pinned, onJump, onUnpin, canUnpin }) {
  if (!pinned?.messageId) return null;
  return (
    <div className="h-12 bg-black/20 border-b border-white/10 flex items-center px-4 gap-3">
      <button type="button" className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-90" onClick={onJump} title="Перейти к сообщению">
        <div className="text-tgHint text-xs">📌</div>
        {pinned.image_data_url ? (
          <img src={pinned.image_data_url} alt="pinned" className="w-8 h-8 rounded-lg object-cover border border-white/10" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10" />
        )}
        <div className="min-w-0">
          <div className="text-white text-sm font-semibold truncate">{pinned.title || 'Закреплённое сообщение'}</div>
          {pinned.text ? <div className="text-tgHint text-xs truncate">{pinned.text}</div> : <div className="text-tgHint text-xs truncate">Нажмите, чтобы перейти</div>}
        </div>
      </button>
      {canUnpin && (
        <button type="button" className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm" onClick={onUnpin} title="Открепить">
          ✕
        </button>
      )}
    </div>
  );
}



function MiniAppModal({ url, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[90]" onClick={onClose}>
      <div className="bg-tgPanel w-[960px] max-w-[96vw] h-[720px] max-h-[92vh] rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 text-white/80 hover:text-white bg-black/30 rounded-full w-9 h-9 flex items-center justify-center">✕</button>
        <iframe src={url} title="miniapp" className="w-full h-full" />
      </div>
    </div>
  );
}

function BadgeInfoModal({ kind, onClose }) {
  const map = {
    premium: { title: 'Premium', text: 'Премиум-аккаунт. Выдаётся админом.' },
    verified: { title: 'Verified', text: 'Верифицированный аккаунт. Выдаётся админом.' },
    youtube: { title: 'YouTube', text: 'Официальный YouTube/контент-креатор. Выдаётся админом.' },
    moderator: { title: 'Модератор', text: 'Модерация: права модерировать чаты. Выдаётся админом.' },
  };
  const info = map[kind] || { title: 'Значок', text: '' };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[90]" onClick={onClose}>
      <div className="bg-tgPanel p-5 rounded-2xl w-[420px] max-w-[92vw] border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="text-white font-bold text-lg">{info.title}</div>
        <div className="text-tgHint text-sm mt-2 whitespace-pre-wrap">{info.text}</div>
        <div className="mt-4 flex justify-end">
          <button className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function ReactionPickerModal({ onPick, onClose }) {
  const EMOJIS = ['👍','❤️','😂','🔥','😮','😢','👎','🎉'];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onClick={onClose}>
      <div className="bg-tgPanel border border-white/10 rounded-2xl p-4 w-[360px] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        <div className="text-white font-semibold mb-3">Реакция</div>
        <div className="grid grid-cols-4 gap-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="py-3 rounded-xl bg-black/20 hover:bg-white/10 border border-white/10 text-xl"
              onClick={() => onPick(e)}
            >
              {e}
            </button>
          ))}
        </div>
        <button className="mt-4 w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function ImageViewerModal({ src, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70]" onClick={onClose}>
      <div className="max-w-[94vw] max-h-[92vh] p-2" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="full" className="max-w-[94vw] max-h-[92vh] object-contain rounded-xl shadow-2xl" />
      </div>
    </div>
  );
}

function PostViewerModal({ post, onClose, onOpenImage, onBadgeClick }) {
  useEffect(() => {
    // views изменяются только через админку
  }, [post?.id, post?.chatId]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-tgPanel p-6 rounded-xl w-[720px] max-w-[94vw] max-h-[90vh] overflow-y-auto shadow-2xl border border-white/10 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>

        <div className="flex items-center gap-3">
          <AvatarCircle dataUrl={post.sender_avatar_data_url} emoji={post.sender_avatar_emoji} fallback={post.sender_username} />
          <div className="min-w-0">
            <div className="text-white font-bold text-lg flex items-center gap-2 truncate">
              <span className="truncate">{post.sender_username || 'User'}</span>
              <BadgesInline badges={post.sender_badges || {}} onBadgeClick={onBadgeClick} />
            </div>
            <div className="text-tgHint text-xs">{prettyTime(post.createdAt)} • 👁 {Number(post.views || 0)}</div>
          </div>
        </div>

        {post.text && <div className="mt-4 whitespace-pre-wrap break-words text-white">{post.text}</div>}

        {post.image_data_url && (
          <img
            src={post.image_data_url}
            className="mt-4 rounded-xl max-h-[70vh] object-contain w-full cursor-zoom-in"
            alt="post"
            loading="lazy"
            onClick={() => onOpenImage?.(post.image_data_url)}
          />
        )}
      </div>
    </div>
  );
}

function PostComposerModal({ me, chat, canPost, onClose, onSend }) {
  const [text, setText] = useState('');
  const [img, setImg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const pick = async (file) => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await imageFileToDataUrlUnderLimit(file, { limitChars: 780_000 });
      setImg(dataUrl);
    } catch {
      setError('Картинка слишком большая. Возьми меньше.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!canPost) return;
    const t = text.trim();
    if (!t && !img) return setError('Добавь текст или фото.');
    setBusy(true);
    setError('');
    try {
      await onSend({ text: t, imageDataUrl: img });
      onClose();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-tgPanel p-6 rounded-xl w-[680px] max-w-[94vw] shadow-2xl border border-white/10 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>
        <div className="text-white font-bold text-xl">Новый пост</div>
        <div className="text-tgHint text-sm mt-1">
          {chat?.type === 'channel' ? 'Пост в канал' : 'Пост в группу'}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <AvatarCircle dataUrl={me.avatar_data_url} emoji={me.avatar_emoji} fallback={me.username} />
          <div className="min-w-0">
            <div className="text-white font-semibold flex items-center gap-2">
              <span className="truncate">{me.displayName || me.username}</span>
              <BadgesInline badges={me.badges || {}} />
            </div>
            <div className="text-tgHint text-xs">@{me.username}</div>
          </div>
        </div>

        <textarea
          className="mt-4 w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[120px]"
          placeholder="Текст поста…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {img && (
          <div className="mt-4">
            <img src={img} className="rounded-xl max-h-72 object-cover w-full" alt="preview" />
            <button
              type="button"
              className="mt-2 text-tgHint text-xs hover:text-white"
              onClick={() => setImg('')}
            >
              убрать фото
            </button>
          </div>
        )}

        {error && <div className="text-red-400 mt-3 text-sm">{error}</div>}

        <div className="mt-5 flex gap-2 items-center">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-4 py-3 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
          >
            📷 фото
          </button>
          <button
            type="button"
            disabled={busy || !canPost}
            onClick={submit}
            className="flex-1 py-3 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold disabled:opacity-60"
          >
            {busy ? '...' : 'Опубликовать'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateChatModal({ myUid, onClose, onCreated }) {
  const [mode, setMode] = useState('group'); // group | channel
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    const t = title.trim();
    if (t.length < 3) return setError('Название слишком короткое (минимум 3 символа).');

    const slug = safeSlug(username);

    try {
      setBusy(true);
      setError('');

      // Ensure unique username if set
      if (slug) {
        const q = query(collection(db, 'chats'), where('username', '==', slug), limit(1));
        const s = await getDocs(q);
        if (s.docs.length) {
          setError('Этот username чата уже занят.');
          return;
        }
      }

      const chatRef = await addDoc(collection(db, 'chats'), {
        type: mode,
        title: t,
        description: description.trim(),
        username: slug,
        visibility: 'public',
        ownerUid: myUid,
        admins: [myUid],
        members: [myUid],
        avatar_data_url: '',
        createdAt: serverTimestamp(),
      });

      onCreated({ id: chatRef.id, type: mode, title: t });
      onClose();
    } catch (e) {
      setError('Не удалось создать.');
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-tgPanel p-6 rounded-xl w-[460px] shadow-2xl border border-white/10 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>
        <h3 className="text-white font-bold text-xl">Создать</h3>
        <div className="text-tgHint text-sm mt-1">Группа: все пишут • Канал: пишет только админ</div>

        <div className="mt-5 flex gap-2">
          <button
            className={`flex-1 py-2 rounded font-bold text-sm border border-white/10 ${
              mode === 'group' ? 'bg-tgBlue text-white' : 'bg-tgDark text-tgHint hover:text-white'
            }`}
            onClick={() => setMode('group')}
            type="button"
          >
            👥 Группа
          </button>
          <button
            className={`flex-1 py-2 rounded font-bold text-sm border border-white/10 ${
              mode === 'channel' ? 'bg-tgBlue text-white' : 'bg-tgDark text-tgHint hover:text-white'
            }`}
            onClick={() => setMode('channel')}
            type="button"
          >
            📣 Канал
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Название…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Username (ссылка, опционально)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <textarea
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[90px]"
            placeholder="Описание (опционально)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <div className="text-red-400 mt-3 text-sm">{error}</div>}

        <div className="mt-6 flex gap-2">
          <button
            className="flex-1 py-3 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold"
            disabled={busy}
            onClick={create}
            type="button"
          >
            {busy ? 'Создаю…' : 'Создать'}
          </button>
          <button
            className="px-4 py-3 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
            onClick={onClose}
            type="button"
          >
            Отмена
          </button>
        </div>

        <div className="mt-4 text-tgHint text-xs">
          Ссылка будет работать как <span className="text-white">?c=username</span> если указан username, иначе <span className="text-white">?chat=ID</span>.
        </div>
      </div>
    </div>
  );
}


function CreateBotModal({ ownerUid, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('');
  const [avatar, setAvatar] = useState('');
  const [webAppUrl, setWebAppUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const [myBots, setMyBots] = useState([]);
  const [editBot, setEditBot] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const qB = query(collection(db, 'bots'), where('ownerUid', '==', ownerUid), limit(10));
        const s = await getDocs(qB);
        if (cancelled) return;
        setMyBots(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch {
        if (!cancelled) setMyBots([]);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ownerUid]);

  const pickAvatar = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await imageFileToDataUrlUnderLimit(file, { limitChars: 320_000, maxSideCandidates: [800, 700, 600, 520], qualityCandidates: [0.82, 0.75, 0.68, 0.6] });
      setAvatar(dataUrl);
    } catch (e) {
      console.error(e);
      setError('Аватар слишком большой');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const create = async () => {
    setError('');
    const u = safeSlug(username).replace(/^@/, '');
    if (!name.trim()) return setError('Название обязательно');
    if (!u) return setError('Username обязателен (без пробелов)');
    setBusy(true);
    try {
      // One user -> one bot (owner can edit later)
      const mineQ = query(collection(db, 'bots'), where('ownerUid', '==', ownerUid), limit(1));
      const mineS = await getDocs(mineQ);
      if (mineS.docs[0]) throw new Error('ONLY_ONE_BOT');

      // check unique bot username
      const q = query(collection(db, 'bots'), where('username', '==', u), limit(1));
      const s = await getDocs(q);
      if (s.docs[0]) throw new Error('USERNAME_TAKEN');

      const botRef = await addDoc(collection(db, 'bots'), {
        ownerUid,
        name: name.trim(),
        username: u,
        about: about.trim(),
        avatar_data_url: avatar || '',
        webAppUrl: webAppUrl.trim(),
        verified: false,
        createdAt: serverTimestamp(),
      });

      // Create owner's private chat with the bot (everyone has their own chat history)
      const chatId = `bot_${botRef.id}_${ownerUid}`;
      await setDoc(doc(db, 'chats', chatId), {
        id: chatId,
        type: 'bot',
        botId: botRef.id,
        botUsername: u,
        title: name.trim(),
        description: about.trim(),
        username: u,
        visibility: 'private',
        ownerUid,
        admins: [ownerUid],
        members: [ownerUid],
        avatar_data_url: avatar || '',
        verified: false,
        webAppUrl: webAppUrl.trim(),
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      });

      onCreated?.({ id: chatId, botId: botRef.id, username: u });
      onClose();
    } catch (e) {
      console.error(e);
      if (String(e?.message) === 'USERNAME_TAKEN') setError('Username уже занят');
      else if (String(e?.message) === 'ONLY_ONE_BOT') setError('У тебя уже есть бот. Один аккаунт — один бот.');
      else setError(e?.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80]" onClick={onClose}>
      <div className="bg-tgPanel p-6 rounded-2xl w-[520px] max-w-[94vw] border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="text-white font-bold text-lg">Create Bot</div>
        <div className="text-tgHint text-xs mt-1">Создай бота и привяжи сайт (mini app)</div>

        {myBots.length > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-tgDark border border-white/10">
            <div className="text-white font-semibold text-sm">Мои боты</div>
            <div className="mt-2 space-y-2">
              {myBots.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 border border-white/10">
                  <AvatarCircle dataUrl={b.avatar_data_url} fallback={b.name || 'B'} small />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">{b.name}</div>
                    <div className="text-xs text-white/60 truncate">@{b.username}</div>
                  </div>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm"
                    onClick={() => setEditBot(b)}
                  >
                    Настроить
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-white/50">Один аккаунт — один бот. Настраивай команды и ссылку здесь.</div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <AvatarCircle dataUrl={avatar} fallback={name || 'B'} />
          <div className="flex-1">
            <input ref={fileRef} type="file" className="hidden" accept="image/*" onChange={(e) => pickAvatar(e.target.files?.[0])} />
            <button type="button" className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm" onClick={() => fileRef.current?.click()}>
              Выбрать аватар
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <input className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white" placeholder="Название бота" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white" placeholder="@username (например mybot)" value={username} onChange={(e) => setUsername(e.target.value)} />
          <textarea className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[90px]" placeholder="Описание" value={about} onChange={(e) => setAbout(e.target.value)} />
          <input className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white" placeholder="Web App URL (необязательно)" value={webAppUrl} onChange={(e) => setWebAppUrl(e.target.value)} />
        </div>

        {error && <div className="text-red-400 text-sm mt-3">{error}</div>}

        <div className="mt-5 flex gap-2">
          <button disabled={busy} className="flex-1 py-3 rounded-xl bg-tgBlue hover:bg-blue-500 text-white font-bold disabled:opacity-60" onClick={create} type="button">
            {busy ? '...' : 'Создать'}
          </button>
          <button className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white" onClick={onClose} type="button">
            Отмена
          </button>
        </div>
      </div>

      {editBot && (
        <BotEditModal bot={editBot} onClose={() => setEditBot(null)} />
      )}
    </div>
  );
}

function BotEditModal({ bot, onClose }) {
  const [webAppUrl, setWebAppUrl] = useState(bot.webAppUrl || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commands, setCommands] = useState([]);
  const [newCmd, setNewCmd] = useState('/start');
  const [newText, setNewText] = useState('Привет!');

  useEffect(() => {
    let unsub = null;
    try {
      const qC = query(collection(db, 'bots', bot.id, 'commands'), orderBy('cmd'));
      unsub = onSnapshot(
        qC,
        (snap) => setCommands(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setCommands([])
      );
    } catch {
      setCommands([]);
    }
    return () => {
      try {
        unsub && unsub();
      } catch {
        // ignore
      }
    };
  }, [bot.id]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateDoc(doc(db, 'bots', bot.id), { webAppUrl: webAppUrl.trim() });
      // also update owner's chat record if exists
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const addCommand = async () => {
    const c = String(newCmd || '').trim();
    if (!c.startsWith('/')) return setError('Команда должна начинаться с /');
    setBusy(true);
    setError('');
    try {
      await setDoc(doc(db, 'bots', bot.id, 'commands', safeSlug(c).replace(/^_/, '') || c), {
        cmd: c,
        text: newText || '',
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[90]" onClick={onClose}>
      <div className="bg-tgPanel p-6 rounded-2xl w-[620px] max-w-[94vw] border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-white font-bold text-lg">Настройки бота</div>
          <button className="text-tgHint hover:text-white" onClick={onClose} type="button">✕</button>
        </div>
        <div className="mt-2 text-tgHint text-sm">@{bot.username}</div>

        <div className="mt-4">
          <div className="text-white/80 text-sm mb-1">WebApp URL (кнопка Open)</div>
          <input className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white" value={webAppUrl} onChange={(e) => setWebAppUrl(e.target.value)} placeholder="https://site.com" />
          <button disabled={busy} type="button" onClick={save} className="mt-2 px-4 py-2 rounded bg-tgBlue/30 text-[#4ea1ff] hover:bg-tgBlue/40">
            Сохранить ссылку
          </button>
        </div>

        <div className="mt-6">
          <div className="text-white font-semibold">Команды</div>
          <div className="mt-2 space-y-2">
            {commands.length === 0 && <div className="text-xs text-white/50">Команд пока нет.</div>}
            {commands.map((c) => (
              <div key={c.id} className="p-3 rounded-xl bg-tgDark border border-white/10">
                <div className="text-white font-semibold text-sm">{c.cmd}</div>
                <div className="text-white/80 text-sm whitespace-pre-wrap mt-1">{c.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-xl bg-tgDark border border-white/10">
            <div className="text-white/80 text-sm">Добавить команду</div>
            <input className="mt-2 w-full p-2 rounded bg-black/20 border border-white/10 text-white" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
            <textarea className="mt-2 w-full p-2 rounded bg-black/20 border border-white/10 text-white min-h-[80px]" value={newText} onChange={(e) => setNewText(e.target.value)} />
            <button disabled={busy} type="button" onClick={addCommand} className="mt-2 px-4 py-2 rounded bg-white/10 hover:bg-white/15 text-white">
              ＋ Добавить
            </button>
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}

function SettingsModal({ profile, meUid, isAdmin, onClose, onProfileUpdated }) {
  const [username, setUsername] = useState(profile.username || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Admin panel
  const [adminSearch, setAdminSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);

  const usernameUpdatedAtMs = useMemo(() => {
    try {
      const d = profile.usernameUpdatedAt?.toDate ? profile.usernameUpdatedAt.toDate() : null;
      return d ? d.getTime() : 0;
    } catch {
      return 0;
    }
  }, [profile.usernameUpdatedAt]);

  const nextUsernameChangeMs = usernameUpdatedAtMs ? usernameUpdatedAtMs + 24 * 60 * 60 * 1000 : 0;
  const canChangeUsername = isAdmin || !usernameUpdatedAtMs || nowMs() >= nextUsernameChangeMs;

  const handleSave = async () => {
    setError('');
    const u = safeSlug(username);
    if (u.length < 3) return setError('Username минимум 3 символа (a-z, 0-9, _).');
    if (!canChangeUsername && u !== profile.username) return setError('Username можно менять раз в 24 часа.');

    try {
      setBusy(true);
      const userRef = doc(db, 'users', meUid);

      const patch = { username: u, displayName: displayName.trim(), about: about.trim() };
      if (u !== profile.username) patch.usernameUpdatedAt = serverTimestamp();
      await updateDoc(userRef, patch);
      try { await updateProfile(auth.currentUser, { displayName: displayName.trim(), photoURL: profile.avatar_data_url || '' }); } catch { }

      const fresh = await getDoc(userRef);
      const data = fresh.data() || {};
      onProfileUpdated({
        ...profile,
        username: data.username || u,
        displayName: data.displayName || displayName.trim(),
        about: data.about || about.trim(),
        avatar_data_url: data.avatar_data_url || profile.avatar_data_url,
        avatar_emoji: data.avatar_emoji || profile.avatar_emoji || '',
        badges: data.badges || profile.badges,
        usernameUpdatedAt: data.usernameUpdatedAt || profile.usernameUpdatedAt,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    setError('');
    setAvatarBusy(true);
    try {
      const dataUrl = await imageFileToDataUrlUnderLimit(file, {
        limitChars: 520_000,
        maxSideCandidates: [512, 420, 360, 300, 256],
        qualityCandidates: [0.86, 0.80, 0.74, 0.68, 0.62],
      });
      const userRef = doc(db, 'users', meUid);
      await updateDoc(userRef, { avatar_data_url: dataUrl, avatar_emoji: '' });
      // photoURL в Auth обычно ожидает URL, но data: тоже часто работает.
      // Если вдруг не получится — профиль в Firestore всё равно обновлён.
      try {
        await updateProfile(auth.currentUser, { photoURL: dataUrl });
      } catch (e) {
        console.warn('updateProfile(photoURL) failed:', e);
      }

      const fresh = await getDoc(userRef);
      const data = fresh.data() || {};
      onProfileUpdated({
        ...profile,
        username: data.username || profile.username,
        avatar_data_url: data.avatar_data_url || dataUrl,
        avatar_emoji: data.avatar_emoji || '',
        badges: data.badges || profile.badges,
        usernameUpdatedAt: data.usernameUpdatedAt || profile.usernameUpdatedAt,
      });
    } catch (e) {
      console.error(e);
      if (String(e?.message || e) === 'IMAGE_TOO_LARGE') setError('Аватар слишком большой.');
      else setError(`Не удалось обновить аватар: ${e?.code || ''} ${e?.message || e}`);
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const run = async () => {
      const term = adminSearch.trim().toLowerCase();
      if (!term) {
        setAdminUsers([]);
        return;
      }
      const qUsers = query(collection(db, 'users'), orderBy('username'), limit(80));
      const snap = await getDocs(qUsers);
      if (cancelled) return;

      const arr = [];
      snap.forEach((d) => {
        const u = d.data();
        const hay = `${u.username || ''} ${u.email || ''}`.toLowerCase();
        if (hay.includes(term)) arr.push(u);
      });
      setAdminUsers(arr.slice(0, 30));
    };

    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [adminSearch, isAdmin]);

  const setBadges = async (uid, patchBadges) => {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { badges: patchBadges });
  };

  const nextChangeText = !canChangeUsername && nextUsernameChangeMs
    ? new Date(nextUsernameChangeMs).toLocaleString()
    : '';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-tgPanel p-6 rounded-xl w-[520px] shadow-2xl border border-white/10 relative max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>
        <h3 className="text-white font-bold text-xl">Профиль</h3>

        <div className="flex items-center gap-4 mt-4">
          <AvatarCircle dataUrl={profile.avatar_data_url} emoji={profile.avatar_emoji} fallback={profile.username} />
          <div className="flex-1">
            <div className="text-white font-bold flex items-center gap-2">
              <span>{profile.username}</span>
              <BadgesInline badges={profile.badges || {}} />
            </div>
            <div className="text-tgHint text-xs">@{profile.username || ''}</div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="px-4 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white cursor-pointer">
              {avatarBusy ? '...' : 'Сменить фото'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickAvatar(e.target.files?.[0])}
                disabled={avatarBusy}
              />
            </label>
            <button
              type="button"
              className="px-4 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
              onClick={() => setShowEmojiPicker(true)}
              disabled={avatarBusy}
            >
              Эмодзи-аватар
            </button>
          </div>
        </div>

        {showEmojiPicker && (
          <EmojiAvatarPicker
            value={profile.avatar_emoji}
            onPick={async (e) => {
              setShowEmojiPicker(false);
              setAvatarBusy(true);
              try {
                const userRef = doc(db, 'users', meUid);
                await updateDoc(userRef, { avatar_data_url: '', avatar_emoji: e });
                const fresh = await getDoc(userRef);
                const data = fresh.data() || {};
                onProfileUpdated({
                  ...profile,
                  avatar_data_url: '',
                  avatar_emoji: data.avatar_emoji || e,
                });
              } finally {
                setAvatarBusy(false);
              }
            }}
            onClose={() => setShowEmojiPicker(false)}
          />
        )}

        <div className="mt-5 flex flex-col gap-3">
          <div>
            <div className="text-tgHint text-xs mb-1">Username (менять раз в 24 часа)</div>
            <input
              className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
            />
            {!canChangeUsername && (
              <div className="text-tgHint text-xs mt-1">Можно поменять после: <span className="text-white">{nextChangeText}</span></div>
            )}
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 px-5 py-3 bg-tgBlue hover:bg-blue-500 rounded text-sm font-bold text-white transition shadow-lg disabled:opacity-60"
            >
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button
              onClick={onClose}
              className="px-5 py-3 bg-tgDark border border-white/10 rounded text-sm font-bold text-tgHint hover:text-white transition"
            >
              Закрыть
            </button>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <h4 className="text-white font-bold">Админка</h4>
            <div className="text-tgHint text-xs mt-1">Выдача модерации/верификации/премиума/YouTube</div>

            <input
              className="mt-3 w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
              placeholder="Поиск пользователя (username или email)…"
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
            />

            {adminUsers.length > 0 && (
              <div className="mt-3 bg-tgDark rounded border border-white/10 overflow-hidden">
                {adminUsers.map((u) => {
                  const b = u.badges || { verified: false, youtube: false, premium: false, moderator: false };
                  const toggle = async (key) => {
                    const next = { ...b, [key]: !b[key] };
                    await setBadges(u.uid, next);
                    setAdminUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, badges: next } : x)));
                  };

                  return (
                    <div key={u.uid} className="px-3 py-3 border-b border-white/5">
                      <div className="flex items-center gap-3">
                        <AvatarCircle dataUrl={u.avatar_data_url} emoji={u.avatar_emoji} fallback={u.username} small />
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-semibold truncate flex items-center gap-2">
                            <span>{u.username}</span>
                            <span className="text-xs">{badgeText(u)}</span>
                          </div>
                          <div className="text-tgHint text-xs truncate">{u.displayName || ''}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <AdminBadgeButton label="🛡️ Модератор" active={!!b.moderator} onClick={() => toggle('moderator')} />
                        <AdminBadgeButton label="✅ Верификация" active={!!b.verified} onClick={() => toggle('verified')} />
                        <AdminBadgeButton label="▶️ YouTube" active={!!b.youtube} onClick={() => toggle('youtube')} />
                        <AdminBadgeButton label="💎 Premium" active={!!b.premium} onClick={() => toggle('premium')} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 text-tgHint text-xs">
              ⚠️ Для безопасности добавь правила Firestore (файл <span className="text-white">firebase_rules/firestore.rules</span> в проекте).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminBadgeButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded border border-white/10 text-sm font-semibold transition ${
        active ? 'bg-tgBlue text-white' : 'bg-tgPanel text-tgHint hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function ChatSettingsModal({ chat, myUid, onClose }) {
  // chat может прийти асинхронно (после открытия модалки), поэтому
  // инициализируем стейт безопасно и синхронизируем при изменении chat.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!chat) return;
    setTitle(chat.title || chat.name || '');
    setDescription(chat.description || '');
    setUsername(chat.username || '');
    setAvatarDataUrl(chat.avatar_data_url || '');
    setAvatarEmoji(chat.avatar_emoji || '');
  }, [chat?.id]);

  if (!chat) return null;

  const pickAvatar = async (file) => {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToDataUrlResized(file, { maxSide: 640, quality: 0.85 });
      if (dataUrl.length > 850_000) {
        setError('Аватар чата слишком большой.');
        return;
      }
      setAvatarDataUrl(dataUrl);
      setAvatarEmoji('');
    } catch {
      setError('Не удалось обработать картинку.');
    }
  };

  const chooseEmoji = (e) => {
    setAvatarEmoji(e);
    setAvatarDataUrl('');
  };

  const save = async () => {
    const t = title.trim();
    if (t.length < 3) return setError('Название минимум 3 символа.');
    const slug = safeSlug(username);

    try {
      setBusy(true);
      setError('');

      // unique username if changed
      if (slug && slug !== (chat.username || '')) {
        const q = query(collection(db, 'chats'), where('username', '==', slug), limit(1));
        const s = await getDocs(q);
        if (s.docs.length) {
          setError('Этот username чата уже занят.');
          return;
        }
      }

      const chatRef = doc(db, 'chats', chat.id);
      await updateDoc(chatRef, {
        title: t,
        description: description.trim(),
        username: slug,
        avatar_data_url: avatarDataUrl || '',
        avatar_emoji: avatarEmoji || '',
        ownerUid: chat.ownerUid || myUid,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-tgPanel p-6 rounded-xl w-[520px] shadow-2xl border border-white/10 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>
        <h3 className="text-white font-bold text-xl">Управление</h3>
        <div className="text-tgHint text-sm mt-1">Только владелец может менять название/описание/username/аватар.</div>

        <div className="mt-4 flex items-center gap-4">
          <AvatarCircle dataUrl={avatarDataUrl} emoji={avatarEmoji} fallback={title} />
          <label className="px-4 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white cursor-pointer">
            Сменить аватар
            <input type="file" accept="image/*" className="hidden" onChange={(e) => pickAvatar(e.target.files?.[0])} />
          </label>
          <button
            type="button"
            className="px-3 py-2 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
            onClick={() => chooseEmoji(avatarEmoji ? '' : EMOJI_AVATARS[0])}
            title="Эмодзи"
          >
            😊
          </button>
        </div>

        {avatarEmoji !== '' && (
          <div className="mt-3 p-2 rounded-xl bg-tgDark border border-white/10 flex flex-wrap gap-1 max-h-[160px] overflow-auto">
            {EMOJI_AVATARS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => chooseEmoji(e)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl hover:bg-white/5 ${avatarEmoji === e ? 'bg-white/10' : ''}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Название…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Username (ссылка, опционально)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <textarea
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[110px]"
            placeholder="Описание…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <div className="text-red-400 mt-3 text-sm">{error}</div>}

        <div className="mt-6 flex gap-2">
          <button
            className="flex-1 py-3 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold"
            disabled={busy}
            onClick={save}
            type="button"
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            className="px-4 py-3 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
            onClick={onClose}
            type="button"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePage({ me, mode = 'username' }) {
  const params = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [u, setU] = useState(null);
  const [err, setErr] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [gifts, setGifts] = useState([]);

  const GIFT_CATALOG = useMemo(
    () => [
      { id: 'rocket', name: 'Ракета', cost: 5, emoji: '🚀' },
      { id: 'tennis', name: 'Теннисный мячик', cost: 15, emoji: '🎾' },
      { id: 'bear', name: 'Мишка', cost: 35, emoji: '🧸' },
      { id: 'diamond', name: 'Алмаз', cost: 50, emoji: '💎' },
      { id: 'trophy', name: 'Кубок', cost: 75, emoji: '🏆' },
      { id: 'crown', name: 'Корона', cost: 120, emoji: '👑' },
      { id: 'ship', name: 'Космолёт', cost: 200, emoji: '🛸' },
    ],
    []
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setErr('');
      setU(null);

      try {
        if (mode === 'uid') {
          const uid = params.uid;
          const snap = await getDoc(doc(db, 'users', uid));
          if (!snap.exists()) throw new Error('Профиль не найден');
          const data = snap.data();
          if (!cancelled) setU(data);
        } else {
          const username = safeSlug(params.username);
          const qU = query(collection(db, 'users'), where('username', '==', username), limit(1));
          const s = await getDocs(qU);
          const d0 = s.docs[0];
          if (!d0) throw new Error('Профиль не найден');
          const data = d0.data();
          if (!cancelled) setU(data);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [params.username, params.uid, mode]);

  // blocked status
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!me?.uid || !u?.uid || u.uid === me.uid) {
          if (!cancelled) setIsBlocked(false);
          return;
        }
        const snap = await getDoc(doc(db, 'users', me.uid, 'blocked', u.uid));
        if (!cancelled) setIsBlocked(snap.exists());
      } catch {
        if (!cancelled) setIsBlocked(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [me?.uid, u?.uid]);

  // gifts (show on profile)
  useEffect(() => {
    let unsub = null;
    if (!u?.uid) return;
    try {
      const qG = query(collection(db, 'users', u.uid, 'gifts'), orderBy('createdAt', 'desc'), limit(24));
      unsub = onSnapshot(
        qG,
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setGifts(arr);
        },
        () => setGifts([])
      );
    } catch {
      // ignore
    }
    return () => {
      try {
        unsub && unsub();
      } catch {
        // ignore
      }
    };
  }, [u?.uid]);

  const openChat = async () => {
    if (!u?.uid) return;
    if (u.uid === me.uid) {
      navigate('/');
      return;
    }
    const chatId = [me.uid, u.uid].sort().join('__');
    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        id: chatId,
        type: 'private',
        title: `${u.username}`,
        description: '',
        username: '',
        visibility: 'private',
        ownerUid: me.uid,
        admins: [me.uid],
        members: [me.uid, u.uid],
        avatar_data_url: '',
        createdAt: serverTimestamp(),
        mate_uid: u.uid,
        mate_username: u.username,
      });
    }
    navigate(`/chat/${chatId}`);
  };

  const toggleBlock = async () => {
    if (!me?.uid || !u?.uid || u.uid === me.uid) return;
    const ref = doc(db, 'users', me.uid, 'blocked', u.uid);
    if (isBlocked) {
      await deleteDoc(ref);
      setIsBlocked(false);
    } else {
      await setDoc(ref, {
        blockedAt: serverTimestamp(),
        byUid: me.uid,
        byUsername: me.username,
      });
      setIsBlocked(true);
    }
    setMenuOpen(false);
  };

  const giftUser = async ({ item, anonymous, note }) => {
    if (!me?.uid || !u?.uid || u.uid === me.uid) return;
    // sender must have enough stars
    const senderRef = doc(db, 'users', me.uid);
    const giftRef = doc(collection(db, 'users', u.uid, 'gifts'));
    const expiresAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await runTransaction(db, async (tx) => {
      const sSnap = await tx.get(senderRef);
      if (!sSnap.exists()) throw new Error('Профиль не найден');
      const stars = Number(sSnap.data()?.stars || 0);
      if (stars < item.cost) throw new Error('Недостаточно звёзд');
      tx.update(senderRef, { stars: stars - item.cost });
      tx.set(giftRef, {
        itemId: item.id,
        name: item.name,
        cost: item.cost,
        emoji: item.emoji,
        fromUid: anonymous ? null : me.uid,
        fromUsername: anonymous ? null : me.username,
        note: note || '',
        createdAt: serverTimestamp(),
        expiresAtMs,
        soldAt: null,
      });
    });
  };

  const sellGift = async (g) => {
    if (!me?.uid || me.uid !== u?.uid) return;
    if (g?.soldAt) return;
    const now = Date.now();
    if (g?.expiresAtMs && now > g.expiresAtMs) return; // too late
    const price = Math.floor(Number(g.cost || 0) * 0.85);
    const giftRef = doc(db, 'users', me.uid, 'gifts', g.id);
    const userRef = doc(db, 'users', me.uid);
    await runTransaction(db, async (tx) => {
      const gs = await tx.get(giftRef);
      if (!gs.exists()) return;
      const data = gs.data() || {};
      if (data.soldAt) return;
      const us = await tx.get(userRef);
      const stars = Number(us.data()?.stars || 0);
      tx.update(userRef, { stars: stars + price });
      tx.update(giftRef, { soldAt: serverTimestamp(), soldPrice: price });
    });
  };

  const copyLink = async () => {
    const origin = window.location.origin;
    const link = u?.username ? `${origin}/u/${u.username}` : `${origin}/id/${u?.uid}`;
    try {
      await navigator.clipboard.writeText(link);
      alert('Ссылка на профиль скопирована!');
    } catch {
      prompt('Скопируй ссылку:', link);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[520px] max-w-[92vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
        <div className="flex items-center justify-between">
          <button className="text-tgHint hover:text-white" onClick={() => navigate(-1)} type="button">
            ← назад
          </button>
          <div className="text-tgHint text-sm">Профиль</div>
          <button
            type="button"
            className="w-10 h-10 rounded-lg hover:bg-white/5 flex items-center justify-center text-tgHint hover:text-white"
            onClick={() => setMenuOpen((v) => !v)}
            title="Меню"
          >
            ☰
          </button>
        </div>

        {menuOpen && !loading && !err && u && (
          <div className="mt-3 p-2 rounded-xl bg-tgDark border border-white/10 flex flex-col gap-1">
            {u.uid !== me.uid && (
              <>
                <button
                  type="button"
                  onClick={toggleBlock}
                  className="px-3 py-2 rounded-lg text-left hover:bg-white/5"
                >
                  {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGiftOpen(true);
                    setMenuOpen(false);
                  }}
                  className="px-3 py-2 rounded-lg text-left hover:bg-white/5"
                >
                  🎁 Подарить подарок
                </button>
              </>
            )}
            <button type="button" onClick={copyLink} className="px-3 py-2 rounded-lg text-left hover:bg-white/5">
              🔗 Скопировать ссылку
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-10 text-center text-tgHint">Загрузка…</div>
        ) : err ? (
          <div className="mt-10 text-center text-red-400">{err}</div>
        ) : (
          <>
            <div className="mt-6 flex items-center gap-4">
              <AvatarCircle dataUrl={u.avatar_data_url} emoji={u.avatar_emoji} fallback={u.username} />
              <div className="min-w-0">
                <div className="text-white font-bold text-2xl flex items-center gap-2">
                  <span className="truncate">{u.username}</span>
                  <BadgesInline badges={u.badges || {}} />
                </div>
                <div className="text-tgHint text-sm">
                  {u.displayName ? <span className="text-white/80">{u.displayName}</span> : null}
                  {u.uid === me.uid ? <span className="ml-2">• Это ваш профиль</span> : null}
                </div>
              </div>
            </div>

            {u.about && (
              <div className="mt-4 p-4 rounded-xl bg-tgDark border border-white/10 text-white/90 whitespace-pre-wrap">
                {u.about}
              </div>
            )}

            {gifts.length > 0 && (
              <div className="mt-4 p-4 rounded-xl bg-tgDark border border-white/10">
                <div className="text-white font-semibold">Подарки</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {gifts.slice(0, 18).map((g) => {
                    const expired = g.expiresAtMs && Date.now() > g.expiresAtMs;
                    const sold = !!g.soldAt;
                    return (
                      <div key={g.id} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2">
                        <span className="text-xl">{g.emoji || '🎁'}</span>
                        <div className="text-sm">
                          <div className="text-white/90">{g.name || 'Подарок'}</div>
                          <div className="text-xs text-white/50">
                            {sold ? 'Продано' : expired ? 'Декор' : 'Можно продать 7 дней'}
                          </div>
                        </div>
                        {me.uid === u.uid && !sold && !expired && (
                          <button
                            type="button"
                            onClick={() => sellGift(g)}
                            className="ml-2 px-3 py-1 rounded bg-tgBlue/20 text-[#4ea1ff] hover:bg-tgBlue/30 text-xs"
                            title="Продать (85%)"
                          >
                            Продать
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-white/50">Продажа: 15% комиссия (вы получите 85%).</div>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <button
                className="flex-1 py-3 rounded bg-tgBlue hover:bg-blue-500 text-white font-bold"
                onClick={openChat}
                type="button"
              >
                {u.uid === me.uid ? 'Открыть чаты' : 'Написать'}
              </button>
              <button
                className="px-4 py-3 rounded bg-tgDark border border-white/10 text-tgHint hover:text-white"
                onClick={copyLink}
                type="button"
              >
                🔗
              </button>
            </div>
          </>
        )}
      </div>

      {giftOpen && u && (
        <GiftModal
          me={me}
          target={u}
          catalog={GIFT_CATALOG}
          onClose={() => setGiftOpen(false)}
          onSend={giftUser}
        />
      )}
    </div>
  );
}

function GiftModal({ me, target, catalog, onClose, onSend }) {
  const [anon, setAnon] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async (item) => {
    try {
      setBusy(true);
      setErr('');
      await onSend({ item, anonymous: anon, note });
      onClose();
      alert('Подарок отправлен!');
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-tgPanel p-6 rounded-xl w-[560px] max-w-[92vw] shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-white font-bold text-lg">Подарить подарок</div>
          <button className="text-tgHint hover:text-white" onClick={onClose} type="button">
            ✕
          </button>
        </div>
        <div className="text-tgHint text-sm mt-1">Кому: <span className="text-white">@{target.username}</span></div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {catalog.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={busy}
              onClick={() => send(g)}
              className="p-3 rounded-xl bg-tgDark border border-white/10 hover:border-white/20 text-left"
            >
              <div className="text-2xl">{g.emoji}</div>
              <div className="mt-1 text-white font-semibold text-sm">{g.name}</div>
              <div className="text-xs text-white/60">⭐ {g.cost}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
          <div className="text-sm text-white/80">Скрыть, кто подарил</div>
        </div>
        <textarea
          className="mt-3 w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white min-h-[90px]"
          placeholder="Описание (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
        <div className="mt-4 text-xs text-white/50">Если подарок не продать за 7 дней — он останется как декор.</div>
      </div>
    </div>
  );
}

function AdminPage({ me }) {
  const navigate = useNavigate();
  const isAdmin = String(me?.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('users'); // users | chats
  const [users, setUsers] = useState([]);
  const [chatsList, setChatsList] = useState([]);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isAdmin) return;
      if (tab !== 'users') return;
      const term = safeSlug(search);
      const qUsers = query(collection(db, 'users'), orderBy('username'), limit(200));
      const snap = await getDocs(qUsers);
      if (cancelled) return;
      const arr = [];
      snap.forEach((d) => {
        const u = d.data();
        if (!term || String(u.username || '').includes(term) || String(u.email || '').toLowerCase().includes(search.trim().toLowerCase())) {
          arr.push(u);
        }
      });
      setUsers(arr.slice(0, 60));
    };

    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, isAdmin, tab]);

useEffect(() => {
  let cancelled = false;
  const run = async () => {
    if (!isAdmin) return;
    if (tab !== 'chats') return;
    const term = search.trim().toLowerCase();
    const qChats = query(collection(db, 'chats'), orderBy('createdAt', 'desc'), limit(200));
    const snap = await getDocs(qChats);
    if (cancelled) return;
    const arr = [];
    snap.forEach((d) => {
      const c = d.data() || {};
      const hay = `${d.id} ${(c.title || '')} ${(c.username || '')}`.toLowerCase();
      if (!term || hay.includes(term)) arr.push({ id: d.id, ...c });
    });
    setChatsList(arr.slice(0, 80));
  };
  const t = setTimeout(run, 250);
  return () => { cancelled = true; clearTimeout(t); };
}, [search, isAdmin, tab]);

  const toggle = async (uid, key) => {
    setBusyId(uid + key);
    try {
      const ref = doc(db, 'users', uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const badges = data.badges || { verified: false, youtube: false, premium: false, moderator: false };
      await updateDoc(ref, { badges: { ...badges, [key]: !badges[key] } });
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, badges: { ...badges, [key]: !badges[key] } } : u)));
    } finally {
      setBusyId('');
    }
  };

  if (!isAdmin) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-tgDark">
        <div className="w-[520px] max-w-[92vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
          <div className="text-white font-bold text-xl">Нет доступа</div>
          <div className="text-tgHint mt-2">Эта страница доступна только администратору.</div>
          <button className="mt-6 px-4 py-3 rounded bg-tgBlue text-white font-bold" onClick={() => navigate('/')} type="button">
            На главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[900px] max-w-[96vw] h-[88vh] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10 flex flex-col">
        <div className="flex items-center justify-between">
          <button className="text-tgHint hover:text-white" onClick={() => navigate(-1)} type="button">
            ← назад
          </button>
          <div className="text-white font-bold text-xl">Админка</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setTab('users')} className={`px-3 py-2 rounded text-xs font-bold border border-white/10 ${tab==='users'?'bg-white/10 text-white':'bg-tgDark text-tgHint hover:text-white'}`}>Пользователи</button>
            <button type="button" onClick={() => setTab('chats')} className={`px-3 py-2 rounded text-xs font-bold border border-white/10 ${tab==='chats'?'bg-white/10 text-white':'bg-tgDark text-tgHint hover:text-white'}`}>Каналы/группы</button>
          </div>
          <div className="w-10" />
        </div>

        <div className="mt-4">
          <input
            className="w-full p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            placeholder="Поиск по username или email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="mt-4 flex-1 overflow-y-auto rounded border border-white/10">
{tab === 'users' ? (
  <>
    {users.map((u) => (
      <div key={u.uid} className="flex items-center gap-3 px-4 py-3 border-b border-black/20">
        <a href={`/u/${u.username}`} className="flex items-center gap-3 min-w-0 hover:underline" title="Открыть профиль">
          <AvatarCircle dataUrl={u.avatar_data_url} emoji={u.avatar_emoji} fallback={u.username} small />
          <div className="min-w-0">
            <div className="text-white font-semibold truncate flex items-center gap-2">
              <span>{u.username}</span>
              <BadgesInline badges={u.badges || {}} />
            </div>
            <div className="text-tgHint text-xs truncate">{u.displayName || ''}</div>
            <div className="text-tgHint text-[11px] truncate">{u.email || ''}</div>
          </div>
        </a>

        <div className="ml-auto flex flex-wrap gap-2">
          {[
            ['moderator', '🛡️ мод'],
            ['verified', '✅ verified'],
            ['youtube', '▶️ yt'],
            ['premium', '💎 prem'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={busyId === u.uid + key}
              onClick={() => toggle(u.uid, key)}
              className={`px-3 py-2 rounded text-xs font-bold border border-white/10 transition ${
                u?.badges?.[key] ? 'bg-tgBlue text-white' : 'bg-tgDark text-tgHint hover:text-white'
              } disabled:opacity-60`}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            className="px-3 py-2 rounded text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-200 hover:bg-red-500/25"
            onClick={async () => {
              const daysStr = prompt('Бан: на сколько дней? (0 = снять бан)', '1');
              if (daysStr == null) return;
              const days = Number(daysStr);
              const reason = days > 0 ? (prompt('Причина бана', 'Нарушение правил') || 'Нарушение правил') : '';
              const until = days > 0 ? (Date.now() + Math.max(0, days) * 24 * 60 * 60 * 1000) : 0;
              try {
                await updateDoc(doc(db, 'users', u.uid), { ban: until ? { until, reason } : null });
                alert(days > 0 ? 'Пользователь забанен.' : 'Бан снят.');
              } catch (e) {
                alert('Не удалось: ' + (e?.message || e));
              }
            }}
          >
            🚫 бан
          </button>
        </div>
      </div>
    ))}
    {users.length === 0 && <div className="p-6 text-tgHint">Нет результатов</div>}
  </>
) : (
  <>
    {chatsList.map((c) => (
      <div key={c.id} className="flex items-center gap-3 px-4 py-3 border-b border-black/20">
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold truncate flex items-center gap-2">
            <span className="truncate">{c.title || c.id}</span>
            {c.verified && <ChatVerifiedBadge />}
            <span className="text-[11px] text-tgHint">({c.type})</span>
          </div>
          <div className="text-tgHint text-xs truncate">
            {c.username ? `@${c.username}` : c.id} • {c.visibility === 'private' ? 'приватный' : 'публичный'}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded text-xs font-bold border border-white/10 bg-tgDark text-tgHint hover:text-white"
            onClick={() => {
              if (c.username) navigate(`/c/${c.username}`);
              else navigate(`/chat/${c.id}`);
            }}
          >
            Открыть
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded text-xs font-bold border border-white/10 ${c.verified ? 'bg-tgBlue text-white' : 'bg-tgDark text-tgHint hover:text-white'}`}
            onClick={async () => {
              setBusyId(c.id + 'verified');
              try {
                await updateDoc(doc(db, 'chats', c.id), { verified: !c.verified });
                setChatsList((p) => p.map((x) => (x.id === c.id ? { ...x, verified: !c.verified } : x)));
              } finally {
                setBusyId('');
              }
            }}
            disabled={busyId === c.id + 'verified'}
          >
            {c.verified ? '✓ галочка' : 'галочка'}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded text-xs font-bold border border-white/10 bg-red-600/80 hover:bg-red-600 text-white"
            onClick={async () => {
              if (!confirm('Удалить канал/группу?')) return;
              setBusyId(c.id + 'del');
              try {
                await updateDoc(doc(db, 'chats', c.id), { deleted: true, title: '[deleted]' });
              } finally {
                setBusyId('');
              }
            }}
            disabled={busyId === c.id + 'del'}
          >
            Удалить
          </button>
        </div>
      </div>
    ))}
    {chatsList.length === 0 && <div className="p-6 text-tgHint">Нет результатов</div>}
  </>
)}
        </div>
      </div>
    </div>
  );
}

function WalletPage({ me }) {
  const navigate = useNavigate();
  const [stars, setStars] = useState(0);

  useEffect(() => {
    let unsub = null;
    try {
      const ref = doc(db, 'users', me.uid);
      unsub = onSnapshot(ref, (s) => {
        const d = s.data() || {};
        setStars(Number(d.stars || 0));
      });
    } catch {
      // ignore
    }
    return () => unsub?.();
  }, [me.uid]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[520px] max-w-[92vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
        <div className="flex items-center justify-between">
          <button className="text-tgHint hover:text-white" onClick={() => navigate(-1)} type="button">← назад</button>
          <div className="text-white font-bold">Кошелёк</div>
          <div className="w-10" />
        </div>
        <div className="mt-6 p-5 rounded-2xl bg-tgDark border border-white/10">
          <div className="text-tgHint text-sm">Мои звёзды</div>
          <div className="text-white font-bold text-4xl mt-2">⭐ {stars}</div>
          <div className="text-tgHint text-xs mt-2">Подарки/маркетплейс добавим следующим обновлением (комиссия, продажи).</div>
        </div>
      </div>
    </div>
  );
}

function LegalPage({ kind }) {
  const navigate = useNavigate();
  const title = kind === 'privacy' ? 'Конфиденциальность' : kind === 'terms' ? 'Условия' : 'Cookies';
  const body = kind === 'privacy'
    ? 'Здесь будет политика конфиденциальности (пример). Мы храним данные профиля и сообщения в Firebase. Не публикуем email другим пользователям.'
    : kind === 'terms'
      ? 'Здесь будут условия использования (пример). Запрещён спам, мошенничество и т.д.'
      : 'Мы используем cookies/localStorage для авторизации, настроек и удобства. Можно удалить данные браузера, чтобы сбросить настройки.';
  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-[820px] max-w-[96vw] p-6 bg-tgPanel rounded-xl shadow-2xl border border-white/10">
        <div className="flex items-center justify-between">
          <button className="text-tgHint hover:text-white" onClick={() => navigate(-1)} type="button">← назад</button>
          <div className="text-white font-bold">{title}</div>
          <div className="w-10" />
        </div>
        <div className="mt-6 p-5 rounded-2xl bg-tgDark border border-white/10 text-white/90 whitespace-pre-wrap">
          {body}
        </div>
      </div>
    </div>
  );
}
