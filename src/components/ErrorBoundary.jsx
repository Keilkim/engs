import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          backgroundColor: '#000',
          color: '#fff',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
            오류가 발생했습니다
          </h1>
          <p style={{ color: '#888', marginBottom: '24px', fontSize: '14px' }}>
            페이지를 새로고침하거나 홈으로 이동해주세요
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '12px 24px',
                backgroundColor: '#0A84FF',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              새로고침
            </button>
            <button
              onClick={this.handleGoHome}
              style={{
                padding: '12px 24px',
                backgroundColor: '#333',
                color: '#fff',
                border: '1px solid #555',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              홈으로
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              fontSize: '12px',
              textAlign: 'left',
              maxWidth: '90vw',
              overflow: 'auto',
              color: '#ff6b6b',
            }}>
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
