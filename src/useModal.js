import { useEffect, useRef } from "react";

// A ref for a <dialog> that opens as a modal on mount.
export function useModal() {
  const ref = useRef(null);
  useEffect(() => {
    // Guarded because StrictMode runs mount effects twice in development.
    if (!ref.current.open) ref.current.showModal();
  }, []);
  return ref;
}
