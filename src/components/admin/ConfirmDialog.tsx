import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { Language } from '../../types/marketplace';

interface ConfirmDialogProps {
  open: boolean;
  lang: Language;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  requireReason?: boolean;
  optionalReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  initialReason?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  lang,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  requireReason = false,
  optionalReason = false,
  reasonLabel,
  reasonPlaceholder,
  initialReason = '',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setError('');
    }
  }, [open, initialReason]);

  if (!open) return null;

  const showReasonInput = requireReason || optionalReason;

  const handleConfirmClick = () => {
    const trimmed = reason.trim();
    if (requireReason && trimmed.length < 3) {
      setError(
        lang === 'bn'
          ? 'অনুগ্রহ করে কমপক্ষে ৩ অক্ষরের একটি স্পষ্ট কারণ লিখুন।'
          : 'Please enter a clear reason (at least 3 characters).'
      );
      return;
    }
    setError('');
    void onConfirm(trimmed);
  };

  const confirmBtnClasses =
    tone === 'danger'
      ? 'bg-[#DC2626] hover:bg-red-700 text-white'
      : tone === 'warning'
        ? 'bg-amber-600 hover:bg-amber-700 text-white'
        : 'bg-[#FF8500] hover:bg-[#e57600] text-white';

  const iconBgClasses =
    tone === 'danger'
      ? 'bg-red-50 dark:bg-red-950/50 text-[#DC2626]'
      : tone === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
        : 'bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500]';

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="p-5 flex items-start justify-between gap-3 border-b border-[#E6ECFA] dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBgClasses}`}>
              {tone === 'danger' ? <ShieldAlert className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100">{title}</h3>
              <p className="text-xs text-[#777777] dark:text-slate-400 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showReasonInput && (
          <div className="p-5 pb-0 space-y-1.5">
            <label className="block text-xs font-bold text-[#172033] dark:text-slate-200">
              {reasonLabel || (lang === 'bn' ? 'কারণ / নোট' : 'Reason / Audit Note')}
              {requireReason && <span className="text-[#DC2626] ml-1">*</span>}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
              placeholder={
                reasonPlaceholder ||
                (lang === 'bn' ? 'অডিট লগের জন্য কারণ লিখুন...' : 'Enter reason for audit log...')
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
            />
            {error && <p className="text-[11px] font-bold text-[#DC2626]">{error}</p>}
          </div>
        )}

        <div className="p-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#172033] dark:text-slate-200 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {cancelLabel || (lang === 'bn' ? 'বাতিল' : 'Cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirmClick}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${confirmBtnClasses}`}
          >
            {busy
              ? lang === 'bn'
                ? 'প্রসেসিং...'
                : 'Processing...'
              : confirmLabel || (lang === 'bn' ? 'নিশ্চিত করুন' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
