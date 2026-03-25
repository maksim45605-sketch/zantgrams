import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './ui/ErrorBoundary.jsx'
import './index.css'

// Hardening for production:
// - StrictMode can double-invoke effects and trigger edge-case bugs;
//   keep the app stable for users.
// - Wrap boot in try/catch so we never end up with a "gray screen".

function renderFatal(err) {
  try {
    const root = document.getElementById('root')
    if (!root) return
    const msg = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err)
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0f1720;color:#e6edf3;font-family:ui-sans-serif,system-ui">
        <div style="max-width:880px;width:100%;background:#111c27;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px 18px 14px;box-shadow:0 10px 30px rgba(0,0,0,.35)">
          <div style="font-weight:700;margin-bottom:6px">ZanTGrams не загрузился из-за ошибки</div>
          <div style="opacity:.85;margin-bottom:12px">Открой DevTools → Console и отправь скрин этой ошибки.</div>
          <pre style="white-space:pre-wrap;word-break:break-word;background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;max-height:45vh;overflow:auto">${msg.replace(/</g,'&lt;')}</pre>
          <button onclick="location.reload()" style="margin-top:12px;background:#3b82f6;color:white;border:0;border-radius:12px;padding:10px 14px;font-weight:600;cursor:pointer">Перезагрузить</button>
        </div>
      </div>
    `
  } catch {}
}

try {
  const el = document.getElementById('root')
  if (!el) throw new Error('Root element #root not found')

  ReactDOM.createRoot(el).render(
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>,
  )
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('Boot error:', e)
  renderFatal(e)
}
