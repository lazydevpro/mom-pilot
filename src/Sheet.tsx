import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** A bottom sheet on phones, a centered dialog on wider screens. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref} className="sheet" aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="sheet-body">
        <header className="sheet-header">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
