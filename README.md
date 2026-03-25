# ZanTGram (Vite + React + Firebase)

Минимальный фронтенд:
- Firebase Auth: Email/Password + Google
- Firestore:
  - profiles: `users/{uid}`
  - username lookup: `usernames/{username}`
  - global chat: `globalMessages/{msgId}`
  - (опционально) posts: `posts/{postId}`

Дополнительно:
- verified галочка (админ выставляет)
- gifts каталог + подарки в профиле
- маркет подарков (комиссия 15%)

## 1) Создай Firebase проект
1. Firebase Console → Create project
2. Authentication → Sign-in method → включи:
   - Email/Password
   - Google
3. Firestore Database → Create database

## 2) Firebase config (для Vite)
В папке `client/` создай `.env` по примеру `.env.example`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## 3) Запуск локально
```
cd client
npm i
npm run dev
```

## 4) Правила Firestore
Файл: `firestore.rules` (в корне проекта).

Через Firebase CLI:
```
npm i -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

## 5) Vercel
- Import Project из GitHub
- Root Directory: `ZanTGram` (корень, чтобы работали `api/...`)
- Vercel сам возьмёт `vercel.json` и соберёт `client/`
- Environment Variables: добавь ключи из `.env` (см. ниже)
- В Firebase Auth → Settings → Authorized domains добавь домен Vercel (например `zangram.vercel.app`)

### Vercel API (подарки/маркет/админ)
В проекте есть Vercel Serverless Functions в папке `api/`.
Они используют **Firebase Admin SDK**, поэтому на Vercel добавь env vars:

```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
```

Где взять:
Firebase Console → Project Settings → Service accounts → Generate new private key.
`FIREBASE_PRIVATE_KEY` вставляй в Vercel как одну строку (переносы строк ок — в коде они восстанавливаются).

## 6) Админ (галочка)
Админом считается пользователь:
- либо с custom claim `{ admin: true }`
- либо с email `m462556532@gmail.com` (email должен быть подтверждён)

В UI слева появится блок **Админ**, где можно дать/снять ✓ по username или UID.

## 7) Подарки
1) Зайди админом → нажми **Создать/обновить каталог подарков** (создаст `giftCatalog/*`)
2) Найди пользователя → **Подарить** → выбери подарок
3) В профиле появится подарок, а в маркете можно купить лоты.

## Важное про фото/аудио
Ты просил хранить фото без Storage — это сделано через `photoData` (dataURL) в Firestore.
НО: Firestore имеет лимит ~1 MiB на документ, поэтому большие фото не влезут.
Для реального продакшена лучше Firebase Storage.
