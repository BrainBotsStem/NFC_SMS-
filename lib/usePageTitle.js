import { useEffect } from 'react';

/** Sets the browser tab title, so several open tabs are easy to tell apart. */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Attendance` : 'Attendance';
  }, [title]);
}
