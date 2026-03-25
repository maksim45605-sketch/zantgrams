import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ZanTGrams runtime error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error || 'Unknown error');
    return (
      <div style={{ minHeight: '100vh', background: '#0b1220', color: '#e6eefc', padding: 24 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Что-то пошло не так</h1>
          <p style={{ opacity: 0.9, marginBottom: 16 }}>
            Если видишь серый экран — открой консоль браузера и пришли ошибку.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'rgba(255,255,255,0.06)',
              padding: 12,
              borderRadius: 12,
            }}
          >
            {msg}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              background: '#2f6fff',
              border: 'none',
              color: 'white',
              padding: '10px 14px',
              borderRadius: 12,
              cursor: 'pointer',
            }}
          >
            Перезагрузить
          </button>
        </div>
      </div>
    );
  }
}
