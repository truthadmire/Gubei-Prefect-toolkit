type ToastRegionProps = {
  message?: string;
};

export default function ToastRegion({ message = "" }: ToastRegionProps) {
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {message && <div className="toast-region__message">{message}</div>}
    </div>
  );
}
