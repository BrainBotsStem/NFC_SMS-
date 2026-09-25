import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const ICONS = { success: 'check', warn: 'alert', error: 'alert', info: 'check' };
const ToastContext = createContext(() => {});

/** toast('Saved'), or toast('Nimal tapped in', { detail: '08:03', type: 'success' }). */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((message, { type = 'success', detail = '', icon } = {}) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-3), { id, message, type, detail, icon }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span className="toast-icon">
              <Icon name={t.icon || ICONS[t.type]} />
            </span>
            <span className="toast-body">
              <strong>{t.message}</strong>
              {t.detail && <span>{t.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
