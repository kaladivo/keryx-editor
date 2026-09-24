import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** A modal dialog; without `onClose` it cannot be dismissed with Escape. */
export function Modal({ title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">{footer}</div>
    </dialog>
  );
}
