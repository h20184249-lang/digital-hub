import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  Edit3,
  Image as ImageIcon,
  KeyRound,
  Lock,
  MessageSquare,
  Package,
  RefreshCw,
  Save,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  Unlock,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  AdminSecurityPayload,
  Announcement,
  AnnouncementType,
  AuditLog,
  Category,
  Coupon,
  Language,
  Order,
  OrderStatus,
  Payment,
  Product,
  Review,
  SiteSettings,
  SupportTicket,
  UserProfile,
} from '../../types/marketplace';
import {
  adminBroadcastAnnouncementServer,
  adminCompleteOrderWithRewardsServer,
  adminDeleteAnnouncement,
  adminDeleteCategory,
  adminDeleteCoupon,
  adminDeleteProduct,
  adminDeleteReview,
  adminFetchSecurityOverview,
  adminQuickUpdatePackage,
  adminRefundAndCancelOrderServer,
  adminReplyTicket,
  adminRevokeSession,
  adminSaveCategory,
  adminSaveCoupon,
  adminSaveProduct,
  adminSaveSiteSettings,
  adminSendNotification,
  adminToggleAnnouncementActive,
  adminToggleReviewApproval,
  adminUnlockAuthAttempt,
  adminUpdateAnnouncementServer,
  adminUpdateOrderStatus,
  adminUploadMediaAsset,
  adminVerifyPaymentServer,
  compressImageToDataUrl,
  formatDateShort,
  generateId,
  optimizePackageLogoFile,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

// =========================================================================
// 1. NOTIFICATIONS & ANNOUNCEMENTS PANEL
// =========================================================================

interface AdminNotificationsPanelProps {
  lang: Language;
  users: UserProfile[];
  announcements: Announcement[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminNotificationsPanel({
  lang,
  users,
  announcements,
  onSuccess,
  onError,
}: AdminNotificationsPanelProps) {
  // Send Notification Form
  const [audienceMode, setAudienceMode] = useState<'all' | 'selected' | 'single'>('all');
  const [targetUid, setTargetUid] = useState(users[0]?.uid || '');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [userPickerSearch, setUserPickerSearch] = useState('');
  const [notifType, setNotifType] = useState<
    'system' | 'wallet' | 'order' | 'payment' | 'referral' | 'promo' | 'new_app' | 'app_update' | 'reward' | 'support'
  >('system');
  const [titleEn, setTitleEn] = useState('');
  const [titleBn, setTitleBn] = useState('');
  const [messageEn, setMessageEn] = useState('');
  const [messageBn, setMessageBn] = useState('');
  const [sending, setSending] = useState(false);

  // Announcement Form (Create + Edit)
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [annType, setAnnType] = useState<AnnouncementType>('general');
  const [annTitleEn, setAnnTitleEn] = useState('');
  const [annTitleBn, setAnnTitleBn] = useState('');
  const [annMsgEn, setAnnMsgEn] = useState('');
  const [annMsgBn, setAnnMsgBn] = useState('');
  const [annImageUrl, setAnnImageUrl] = useState('');
  const [annStartDate, setAnnStartDate] = useState('');
  const [annExpiresAt, setAnnExpiresAt] = useState('');
  const [annDismissible, setAnnDismissible] = useState(true);
  const [annActive, setAnnActive] = useState(true);
  const [uploadingAnnImg, setUploadingAnnImg] = useState(false);
  const [postingAnn, setPostingAnn] = useState(false);

  const resetAnnForm = () => {
    setEditingAnnId(null);
    setAnnType('general');
    setAnnTitleEn('');
    setAnnTitleBn('');
    setAnnMsgEn('');
    setAnnMsgBn('');
    setAnnImageUrl('');
    setAnnStartDate('');
    setAnnExpiresAt('');
    setAnnDismissible(true);
    setAnnActive(true);
  };

  const handleUploadAnnouncementImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAnnImg(true);
    try {
      const optimized = await optimizePackageLogoFile(file, 1024);
      const uploaded = await adminUploadMediaAsset(optimized);
      setAnnImageUrl(uploaded.url);
      onSuccess('Announcement image uploaded.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload announcement image.');
    } finally {
      setUploadingAnnImg(false);
    }
  };

  const todayDhakaIso = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, []);

  const filteredPickerUsers = useMemo(() => {
    const q = userPickerSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 60);
    return users
      .filter(
        (u) =>
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [users, userPickerSearch]);

  const toggleSelectedUid = (uid: string) => {
    setSelectedUids((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  };

  const handleSendNotification = async (e: FormEvent) => {
    e.preventDefault();
    if (!titleEn.trim() || !messageEn.trim()) {
      onError('Notification title and message are required.');
      return;
    }
    if (audienceMode === 'selected' && selectedUids.length === 0) {
      onError('Please select at least one user from the list.');
      return;
    }
    if (audienceMode === 'single' && !targetUid) {
      onError('Please pick a recipient user.');
      return;
    }
    setSending(true);
    try {
      const res = await adminSendNotification({
        ...(audienceMode === 'selected'
          ? { targetUids: selectedUids }
          : { targetUid: audienceMode === 'all' ? 'ALL' : targetUid }),
        titleEn: titleEn.trim(),
        titleBn: titleBn.trim() || titleEn.trim(),
        messageEn: messageEn.trim(),
        messageBn: messageBn.trim() || messageEn.trim(),
        type: notifType,
      });
      onSuccess(
        audienceMode === 'all'
          ? `Broadcast sent to ${res.recipientCount} active user(s).`
          : audienceMode === 'selected'
            ? `Notification sent to ${res.recipientCount} selected user(s).`
            : `Direct notification sent to recipient.`
      );
      setTitleEn('');
      setTitleBn('');
      setMessageEn('');
      setMessageBn('');
      if (audienceMode === 'selected') setSelectedUids([]);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send notification.');
    } finally {
      setSending(false);
    }
  };

  const handleSaveAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    if (!annTitleEn.trim() || !annMsgEn.trim()) {
      onError('Announcement title and message are required.');
      return;
    }
    if (annStartDate && annExpiresAt && annExpiresAt < annStartDate) {
      onError('Expiration date cannot be earlier than start date.');
      return;
    }
    setPostingAnn(true);
    try {
      const payload = {
        titleEn: annTitleEn.trim(),
        titleBn: annTitleBn.trim() || annTitleEn.trim(),
        messageEn: annMsgEn.trim(),
        messageBn: annMsgBn.trim() || annMsgEn.trim(),
        type: annType,
        imageUrl: annImageUrl.trim(),
        startDate: annStartDate.trim(),
        expiresAt: annExpiresAt.trim(),
        dismissible: annDismissible,
        active: annActive,
      };
      if (editingAnnId) {
        await adminUpdateAnnouncementServer(editingAnnId, payload);
        onSuccess('Public site announcement updated.');
      } else {
        await adminBroadcastAnnouncementServer(payload);
        onSuccess('Public site announcement published.');
      }
      resetAnnForm();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save announcement.');
    } finally {
      setPostingAnn(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Direct / Selected / Broadcast Notification Composer */}
      <form
        onSubmit={handleSendNotification}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-[#FF8500]" />
            {lang === 'bn'
              ? 'ব্রডকাস্ট / ইউজার নোটিফিকেশন (সবাই, নির্বাচিত বা একক)'
              : 'Send Notifications (All Users, Selected Users, or Single User)'}
          </h3>
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F3F6FF] dark:bg-slate-950 border border-[#E6ECFA] dark:border-slate-800 text-[11px] font-bold">
            {(
              [
                { id: 'all', label: lang === 'bn' ? 'সব ইউজার' : 'All Users' },
                { id: 'selected', label: lang === 'bn' ? `নির্বাচিত (${selectedUids.length})` : `Selected (${selectedUids.length})` },
                { id: 'single', label: lang === 'bn' ? 'একক ইউজার' : 'Single User' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setAudienceMode(mode.id)}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  audienceMode === mode.id
                    ? 'bg-[#FF8500] text-white'
                    : 'text-[#5C6B84] dark:text-slate-400 hover:text-[#172033] dark:hover:text-white'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {audienceMode === 'single' ? (
            <div>
              <label className="block font-bold mb-1">Select Single Recipient</label>
              <select
                value={targetUid}
                onChange={(e) => setTargetUid(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              >
                <option value="">— Choose User —</option>
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName || u.uid} ({u.email || u.phone || u.uid})
                  </option>
                ))}
              </select>
            </div>
          ) : audienceMode === 'all' ? (
            <div className="rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 px-3.5 py-2.5 flex items-center justify-between">
              <span className="font-bold text-[#172033] dark:text-slate-100">Broadcast to All Active Users</span>
              <span className="font-mono-num font-extrabold text-[#FF8500]">
                {users.filter((u) => u.status === 'active').length} users
              </span>
            </div>
          ) : (
            <div className="sm:col-span-2 rounded-xl bg-[#F8FAFF] dark:bg-slate-950 border border-[#E6ECFA] dark:border-slate-800 p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="text"
                  value={userPickerSearch}
                  onChange={(e) => setUserPickerSearch(e.target.value)}
                  placeholder="Filter users by name, email, or phone..."
                  className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-xs"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedUids(filteredPickerUsers.map((u) => u.uid))}
                    className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 font-bold text-[11px] cursor-pointer"
                  >
                    Select Visible
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedUids([])}
                    className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 font-bold text-[11px] cursor-pointer"
                  >
                    Clear ({selectedUids.length})
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pr-1">
                {filteredPickerUsers.map((u) => {
                  const checked = selectedUids.includes(u.uid);
                  return (
                    <label
                      key={u.uid}
                      className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-colors ${
                        checked
                          ? 'bg-[#FFF3E5] dark:bg-orange-950/40 border-[#FF8500]/60'
                          : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedUid(u.uid)}
                        className="accent-[#FF8500] shrink-0"
                      />
                      <span className="truncate">
                        <span className="font-bold block truncate">{u.displayName || u.uid}</span>
                        <span className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 block truncate">
                          {u.email || u.phone || u.uid}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">Category</label>
            <select
              value={notifType}
              onChange={(e) =>
                setNotifType(
                  e.target.value as
                    | 'system'
                    | 'wallet'
                    | 'order'
                    | 'payment'
                    | 'referral'
                    | 'promo'
                    | 'new_app'
                    | 'app_update'
                    | 'reward'
                    | 'support'
                )
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              <option value="system">System Alert</option>
              <option value="promo">Special Offer / Promo</option>
              <option value="new_app">New App Release</option>
              <option value="app_update">App Update</option>
              <option value="reward">Reward / Coin Bonus</option>
              <option value="wallet">Wallet Update</option>
              <option value="payment">Payment Notice</option>
              <option value="order">Order Update</option>
              <option value="support">Support Reply</option>
              <option value="referral">Referral Bonus</option>
            </select>
          </div>
          <input
            type="text"
            required
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder="Title (English) *"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <input
            type="text"
            value={titleBn}
            onChange={(e) => setTitleBn(e.target.value)}
            placeholder="Title (Bangla - optional)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <textarea
            rows={2}
            required
            value={messageEn}
            onChange={(e) => setMessageEn(e.target.value)}
            placeholder="Message body (English) *"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <textarea
            rows={2}
            value={messageBn}
            onChange={(e) => setMessageBn(e.target.value)}
            placeholder="Message body (Bangla - optional)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            {sending
              ? 'Sending...'
              : audienceMode === 'all'
                ? 'Send Broadcast to All'
                : audienceMode === 'selected'
                  ? `Send to ${selectedUids.length} Selected User(s)`
                  : 'Send Direct Notification'}
          </button>
        </div>
      </form>

      {/* Public Announcements Manager */}
      <form
        onSubmit={handleSaveAnnouncement}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
            {editingAnnId
              ? lang === 'bn'
                ? 'অ্যানাউন্সমেন্ট এডিট করুন'
                : 'Edit Site Announcement'
              : lang === 'bn'
                ? 'সাইট অ্যানাউন্সমেন্ট ব্যানার'
                : 'Site-Wide Announcements'}
          </h3>
          {editingAnnId && (
            <button
              type="button"
              onClick={resetAnnForm}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" /> Cancel Edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={annType}
            onChange={(e) => setAnnType(e.target.value as AnnouncementType)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          >
            <option value="general">General</option>
            <option value="offer">Special Offer</option>
            <option value="update">Platform Update</option>
            <option value="important">Important Alert</option>
            <option value="info">Info (Legacy)</option>
            <option value="promo">Promo (Legacy)</option>
            <option value="policy">Policy</option>
            <option value="maintenance">Maintenance</option>
          </select>
          <input
            type="text"
            required
            value={annTitleEn}
            onChange={(e) => setAnnTitleEn(e.target.value)}
            placeholder="Announcement Title (EN) *"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <input
            type="text"
            value={annTitleBn}
            onChange={(e) => setAnnTitleBn(e.target.value)}
            placeholder="Announcement Title (BN)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <textarea
            rows={2}
            required
            value={annMsgEn}
            onChange={(e) => setAnnMsgEn(e.target.value)}
            placeholder="Announcement Message (EN) *"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 sm:col-span-2"
          />
          <textarea
            rows={2}
            value={annMsgBn}
            onChange={(e) => setAnnMsgBn(e.target.value)}
            placeholder="Announcement Message (BN)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
          <div className="sm:col-span-2 flex items-center gap-2">
            <input
              type="text"
              value={annImageUrl}
              onChange={(e) => setAnnImageUrl(e.target.value)}
              placeholder="Optional announcement image URL or upload..."
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
            <label className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer hover:border-[#FF8500] shrink-0">
              <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
              <span>{uploadingAnnImg ? '...' : 'Image'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploadingAnnImg}
                onChange={(e) => void handleUploadAnnouncementImage(e)}
              />
            </label>
          </div>
          <div>
            <input
              type="date"
              value={annStartDate}
              onChange={(e) => setAnnStartDate(e.target.value)}
              title="Start Date (optional)"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <input
              type="date"
              value={annExpiresAt}
              onChange={(e) => setAnnExpiresAt(e.target.value)}
              title="Expiration Date (optional)"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={annDismissible}
                onChange={(e) => setAnnDismissible(e.target.checked)}
                className="accent-[#FF8500]"
              />
              <span>Dismissible by visitors</span>
            </label>
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={annActive}
                onChange={(e) => setAnnActive(e.target.checked)}
                className="accent-[#FF8500]"
              />
              <span>Published / Active</span>
            </label>
          </div>
          <button
            type="submit"
            disabled={postingAnn || uploadingAnnImg}
            className="px-4 py-2 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white font-bold disabled:opacity-50 cursor-pointer"
          >
            {postingAnn
              ? 'Saving...'
              : editingAnnId
                ? 'Update Announcement'
                : 'Publish Announcement'}
          </button>
        </div>
      </form>

      <div className="space-y-2.5">
        {announcements.map((a) => {
          const isScheduled = Boolean(a.startDate && a.startDate > todayDhakaIso);
          const isExpired = Boolean(a.expiresAt && a.expiresAt < todayDhakaIso);
          return (
            <div
              key={a.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                {a.imageUrl && (
                  <img
                    src={a.imageUrl}
                    alt={a.titleEn}
                    className="w-12 h-12 rounded-xl object-cover shrink-0 border border-[#E6ECFA] dark:border-slate-700"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold uppercase text-[10px]">
                      {a.type}
                    </span>
                    {!a.active ? (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold text-[10px]">
                        Paused
                      </span>
                    ) : isExpired ? (
                      <span className="px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/40 text-[#DC2626] font-bold text-[10px]">
                        Expired {a.expiresAt}
                      </span>
                    ) : isScheduled ? (
                      <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold text-[10px]">
                        Starts {a.startDate}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold text-[10px]">
                        Live on Homepage
                      </span>
                    )}
                    <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{a.titleEn}</p>
                  </div>
                  <p className="text-[#777777] dark:text-slate-400 mt-0.5">{a.messageEn}</p>
                  {(a.startDate || a.expiresAt || a.dismissible === false) && (
                    <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 mt-1 flex items-center gap-2">
                      {(a.startDate || a.expiresAt) && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {a.startDate || 'Now'} → {a.expiresAt || 'No expiry'}
                        </span>
                      )}
                      {a.dismissible === false && <span>· Pinned (non-dismissible)</span>}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingAnnId(a.id);
                    setAnnType(a.type || 'general');
                    setAnnTitleEn(a.titleEn || '');
                    setAnnTitleBn(a.titleBn || '');
                    setAnnMsgEn(a.messageEn || '');
                    setAnnMsgBn(a.messageBn || '');
                    setAnnImageUrl(a.imageUrl || '');
                    setAnnStartDate(a.startDate || '');
                    setAnnExpiresAt(a.expiresAt || '');
                    setAnnDismissible(a.dismissible !== false);
                    setAnnActive(a.active !== false);
                  }}
                  className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 cursor-pointer"
                  title="Edit Announcement"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await adminToggleAnnouncementActive(a.id, !a.active);
                    onSuccess(`Announcement ${!a.active ? 'activated' : 'paused'}.`);
                  }}
                  className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${
                    a.active
                      ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {a.active ? 'Active' : 'Paused'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (editingAnnId === a.id) resetAnnForm();
                    await adminDeleteAnnouncement(a.id);
                    onSuccess('Announcement deleted.');
                  }}
                  className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// 2. WEBSITE SETTINGS PANEL (DYNAMIC REAL-TIME CONFIG + MAINTENANCE GUARD)
// =========================================================================

interface AdminSettingsPanelProps {
  lang: Language;
  settings: SiteSettings;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminSettingsPanel({
  lang,
  settings,
  onSuccess,
  onError,
}: AdminSettingsPanelProps) {
  const [draft, setDraft] = useState<SiteSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [confirmMaint, setConfirmMaint] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'faviconUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, field === 'faviconUrl' ? 128 : 320, 0.8);
      setDraft((prev) => ({ ...prev, [field]: dataUrl }));
    } catch {
      onError('Could not process image file.');
    }
  };

  const commitSave = async (nextSettings: SiteSettings) => {
    setSaving(true);
    try {
      await adminSaveSiteSettings(nextSettings);
      onSuccess(
        lang === 'bn'
          ? 'ওয়েবসাইট সেটিংস সফলভাবে সংরক্ষিত ও সক্রিয় হয়েছে।'
          : 'Website settings saved and applied live.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.maintenanceMode && !settings.maintenanceMode) {
      setConfirmMaint(true);
      return;
    }
    await commitSave(draft);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-xs">
      {/* Brand Identity */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
          {lang === 'bn' ? 'ওয়েবসাইট পরিচিতি ও ব্র্যান্ডিং' : 'Website Identity & Branding'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-bold mb-1">Website Name</label>
            <input
              type="text"
              value={draft.siteName || ''}
              onChange={(e) => setDraft({ ...draft, siteName: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Default Theme</label>
            <select
              value={draft.defaultTheme || 'light'}
              onChange={(e) => setDraft({ ...draft, defaultTheme: e.target.value as 'light' | 'dark' })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              <option value="light">Light Mode</option>
              <option value="dark">Dark Mode</option>
            </select>
          </div>
          <div>
            <label className="block font-bold mb-1">Logo URL (or Upload)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft.logoUrl || ''}
                onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
                placeholder="https://... or upload"
                className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
              <label className="px-3 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleImageUpload(e, 'logoUrl')}
                />
              </label>
            </div>
          </div>
          <div>
            <label className="block font-bold mb-1">Favicon URL (or Upload)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft.faviconUrl || ''}
                onChange={(e) => setDraft({ ...draft, faviconUrl: e.target.value })}
                placeholder="https://... or upload"
                className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
              <label className="px-3 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleImageUpload(e, 'faviconUrl')}
                />
              </label>
            </div>
          </div>
          <div>
            <label className="block font-bold mb-1">Announcement Ticker (BN)</label>
            <input
              type="text"
              value={draft.announcementBn || ''}
              onChange={(e) => setDraft({ ...draft, announcementBn: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Announcement Ticker (EN)</label>
            <input
              type="text"
              value={draft.announcementEn || ''}
              onChange={(e) => setDraft({ ...draft, announcementEn: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Site Description (EN)</label>
            <textarea
              rows={2}
              value={draft.descriptionEn || ''}
              onChange={(e) => setDraft({ ...draft, descriptionEn: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Site Description (BN)</label>
            <textarea
              rows={2}
              value={draft.descriptionBn || ''}
              onChange={(e) => setDraft({ ...draft, descriptionBn: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-bold mb-1.5">Brand Accent Theme Color</label>
            <div className="flex flex-wrap items-center gap-2">
              {['#FF8500', '#2563EB', '#059669', '#DC2626', '#7C3AED'].map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setDraft({ ...draft, accentColor: hex })}
                  className={`w-7 h-7 rounded-full border-2 ${
                    (draft.accentColor || '#FF8500').toUpperCase() === hex.toUpperCase()
                      ? 'border-[#172033] dark:border-white scale-110'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: hex }}
                  aria-label={`Select accent color ${hex}`}
                />
              ))}
              <input
                type="color"
                value={draft.accentColor || '#FF8500'}
                onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
                className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
              />
              <input
                type="text"
                value={draft.accentColor || '#FF8500'}
                onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
                className="w-28 px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num uppercase"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Access, Auth & Maintenance Switches */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
          {lang === 'bn' ? 'অ্যাক্সেস, অথেনটিকেশন ও রক্ষণাবেক্ষণ' : 'Access, Authentication & System Controls'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(
            [
              ['maintenanceMode', 'Maintenance Mode (Admin bypass stays active)', true],
              ['registrationEnabled', 'Public Registration Enabled', false],
              ['emailAuthEnabled', 'Email + Password Auth Enabled', false],
              ['phoneAuthEnabled', 'Bangladesh Phone (+880) Auth Enabled', false],
              ['withdrawalsEnabled', 'User Withdrawals Enabled', false],
              ['referralEnabled', 'Referral System Enabled', false],
              ['adsEnabled', 'Advertisements Enabled', false],
              ['loginAlertsEnabled', 'New-IP Login Security Alerts', false],
              ['cashbackEnabled', 'Order Cashback Program Enabled', false],
            ] as Array<[keyof SiteSettings, string, boolean]>
          ).map(([key, label, isDanger]) => (
            <label
              key={key}
              className={`p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                isDanger && draft[key]
                  ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900 text-[#DC2626]'
                  : 'bg-[#F8FAFF] dark:bg-slate-800/60 border-[#E6ECFA] dark:border-slate-700'
              }`}
            >
              <span className="font-bold">{label}</span>
              <input
                type="checkbox"
                checked={key === 'maintenanceMode' ? Boolean(draft[key]) : draft[key] !== false}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
                className="accent-[#FF8500] w-4 h-4 shrink-0"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div>
            <label className="block font-bold mb-1">Global Min Withdrawal (BDT)</label>
            <input
              type="number"
              min={10}
              value={draft.minWithdrawalBdt ?? 100}
              onChange={(e) => setDraft({ ...draft, minWithdrawalBdt: Math.max(10, Number(e.target.value) || 100) })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Contact Email</label>
            <input
              type="email"
              value={draft.contactEmail || ''}
              onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Contact Phone</label>
            <input
              type="text"
              value={draft.contactPhone || ''}
              onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">WhatsApp Link</label>
            <input
              type="url"
              value={draft.whatsappLink || ''}
              onChange={(e) => setDraft({ ...draft, whatsappLink: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Telegram Support Link</label>
            <input
              type="url"
              value={draft.telegramLink || ''}
              onChange={(e) => setDraft({ ...draft, telegramLink: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Telegram Channel Link</label>
            <input
              type="url"
              value={draft.telegramChannelLink || ''}
              onChange={(e) => setDraft({ ...draft, telegramChannelLink: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Messenger Support Link</label>
            <input
              type="url"
              value={draft.messengerLink || ''}
              onChange={(e) => setDraft({ ...draft, messengerLink: e.target.value })}
              placeholder="https://m.me/yourpage"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
        </div>
      </div>

      {/* Watch Ads & Earn Coins Controls */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'ওয়াচ অ্যাডস ও আর্ন কয়েন সেটিংস' : 'Watch Ads & Earn Coins Settings'}
          </h3>
          <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={draft.watchEarnEnabled !== false}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  watchEarnEnabled: e.target.checked,
                  rewardedAdEnabled: e.target.checked,
                })
              }
              className="accent-[#FF8500] w-4 h-4"
            />
            <span>{lang === 'bn' ? 'ওয়াচ ও আর্ন সক্রিয়' : 'Watch & Earn Enabled'}</span>
          </label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block font-bold mb-1">Coins Per 5s Ad</label>
            <input
              type="number"
              min={1}
              value={draft.watchEarnCoinsPerAd ?? 5}
              onChange={(e) =>
                setDraft({ ...draft, watchEarnCoinsPerAd: Math.max(1, Number(e.target.value) || 5) })
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Coins Per ৳1 BDT</label>
            <input
              type="number"
              min={1}
              value={draft.watchEarnCoinsPerBdt ?? 10}
              onChange={(e) =>
                setDraft({ ...draft, watchEarnCoinsPerBdt: Math.max(1, Number(e.target.value) || 10) })
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Daily Ad Limit (Max 20)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.rewardedAdDailyLimit ?? 10}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  rewardedAdDailyLimit: Math.min(20, Math.max(1, Number(e.target.value) || 10)),
                })
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Daily Coin Cap</label>
            <input
              type="number"
              min={10}
              value={draft.watchEarnDailyCoinLimit ?? 100}
              onChange={(e) =>
                setDraft({ ...draft, watchEarnDailyCoinLimit: Math.max(10, Number(e.target.value) || 100) })
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Min Redeem Coins</label>
            <input
              type="number"
              min={10}
              value={draft.watchEarnMinRedeemCoins ?? 50}
              onChange={(e) =>
                setDraft({ ...draft, watchEarnMinRedeemCoins: Math.max(10, Number(e.target.value) || 50) })
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
        </div>
      </div>

      {/* Official Receiving Numbers */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
          {lang === 'bn' ? 'অফিশিয়াল ডিপোজিট নম্বর (বিকাশ / নগদ / রকেট)' : 'Storefront Receiving Numbers (bKash / Nagad / Rocket)'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-bold mb-1">bKash Number</label>
            <input
              type="text"
              value={draft.bkashNumber || ''}
              onChange={(e) => setDraft({ ...draft, bkashNumber: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Nagad Number</label>
            <input
              type="text"
              value={draft.nagadNumber || ''}
              onChange={(e) => setDraft({ ...draft, nagadNumber: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Rocket Number</label>
            <input
              type="text"
              value={draft.rocketNumber || ''}
              onChange={(e) => setDraft({ ...draft, rocketNumber: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving Settings...' : lang === 'bn' ? 'সব সেটিংস সংরক্ষণ করুন' : 'Save Website Settings'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmMaint}
        lang={lang}
        title="Enable Maintenance Mode?"
        description="Public visitors and standard users will see the Maintenance Mode screen until you turn it off. Super Admin access remains active."
        tone="warning"
        confirmLabel="Enable Maintenance Mode"
        busy={saving}
        onCancel={() => setConfirmMaint(false)}
        onConfirm={async () => {
          setConfirmMaint(false);
          await commitSave(draft);
        }}
      />
    </form>
  );
}

// =========================================================================
// 3. SECURITY CENTER PANEL (SUPER ADMIN + SESSIONS + LOCKOUTS + DELETIONS)
// =========================================================================

interface AdminSecurityPanelProps {
  lang: Language;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminSecurityPanel({ lang, onSuccess, onError }: AdminSecurityPanelProps) {
  const [data, setData] = useState<AdminSecurityPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFetchSecurityOverview();
      setData(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load security overview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-5 text-xs">
      <div className="rounded-2xl bg-slate-900 text-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#FF8500] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            Permanent Super Admin Security Lock
          </p>
          <p className="text-base font-extrabold font-mono-num">
            {data?.superAdminEmail || 'ftake810@gmail.com'}
          </p>
          <p className="text-slate-300">
            Role verified exclusively via backend environment variable &amp; HTTP-only session cookie. Client-side spoofing is ignored.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold inline-flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Security State
        </button>
      </div>

      {/* Active Sessions */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-[#FF8500]" />
            Active Authenticated Sessions ({data?.activeSessions.length ?? 0})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-2.5 px-4 font-bold">User</th>
                <th className="py-2.5 px-4 font-bold">Role</th>
                <th className="py-2.5 px-4 font-bold">IP Address</th>
                <th className="py-2.5 px-4 font-bold">Last Seen</th>
                <th className="py-2.5 px-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {(data?.activeSessions || []).map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 px-4">
                    <p className="font-bold text-[#172033] dark:text-slate-100">
                      {s.userName} {s.isCurrent ? '(Current)' : ''}
                    </p>
                    <p className="text-[10px] font-mono-num text-[#777777]">{s.userIdentifier}</p>
                  </td>
                  <td className="py-2.5 px-4 uppercase font-bold text-[10px]">{s.role}</td>
                  <td className="py-2.5 px-4 font-mono-num">{s.ipAddress || '—'}</td>
                  <td className="py-2.5 px-4 text-[#777777]">{formatDateShort(s.lastSeenAt, lang)}</td>
                  <td className="py-2.5 px-4 text-right">
                    {s.role === 'super_admin' && !s.isCurrent ? (
                      <span className="text-[10px] font-bold text-slate-400">Protected</span>
                    ) : !s.isCurrent ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await adminRevokeSession({ sessionId: s.id });
                            onSuccess(`Session revoked for ${s.userName}.`);
                            await load();
                          } catch (err) {
                            onError(err instanceof Error ? err.message : 'Revoke failed.');
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold"
                      >
                        Force Revoke
                      </button>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-600">Active Now</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Brute Force Rate-Limit Tracker */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
          <Lock className="w-4 h-4 text-[#FF8500]" />
          Failed Login Rate-Limit Monitor ({data?.authAttempts.length ?? 0})
        </h3>
        {(data?.authAttempts || []).length === 0 ? (
          <p className="text-[#777777] py-4 text-center">No failed login attempts or active lockouts.</p>
        ) : (
          <div className="space-y-2">
            {(data?.authAttempts || []).map((a) => (
              <div
                key={a.key}
                className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="font-mono-num font-bold text-[#172033] dark:text-slate-100">{a.key}</p>
                  <p className="text-[11px] text-[#777777]">
                    Attempts: {a.attempts} · {a.isLocked ? 'LOCKED' : 'Monitoring'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await adminUnlockAuthAttempt(a.key);
                    onSuccess(`Unlocked rate-limit key ${a.key}.`);
                    await load();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Unlock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Threat Intelligence Monitors: Suspicious Accounts, Repeated Payments, Abnormal Referrals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="text-xs font-extrabold uppercase text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
            Suspicious Accounts ({data?.suspiciousAccounts?.length ?? 0})
          </h4>
          {(data?.suspiciousAccounts || []).length === 0 ? (
            <p className="text-[#777777] py-3">No suspicious multi-IP or brute-force anomalies detected.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(data?.suspiciousAccounts || []).map((item, idx) => (
                <div
                  key={`${item.uid}_${idx}`}
                  className={`p-2.5 rounded-xl border ${
                    item.severity === 'high'
                      ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900'
                      : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{item.userName}</p>
                    <span className="text-[10px] font-extrabold uppercase text-[#DC2626]">{item.severity}</span>
                  </div>
                  <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 truncate">
                    {item.identifier}
                  </p>
                  <p className="text-[11px] font-semibold text-[#DC2626] dark:text-rose-400 mt-0.5">{item.reason}</p>
                  <p className="text-[10px] text-[#777777] dark:text-slate-400">{item.details}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="text-xs font-extrabold uppercase text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Repeated / Rejected Payments ({data?.repeatedPaymentAttempts?.length ?? 0})
          </h4>
          {(data?.repeatedPaymentAttempts || []).length === 0 ? (
            <p className="text-[#777777] py-3">No repeated or abusive payment attempts detected.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(data?.repeatedPaymentAttempts || []).map((item) => (
                <div
                  key={item.key}
                  className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{item.label}</p>
                    <span className="font-mono-num font-extrabold text-[#FF8500] shrink-0">
                      ৳{item.totalAmountBdt.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-0.5">{item.reason}</p>
                  <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400">
                    Total: {item.totalCount} · Rejected: {item.rejectedCount} · 24h: {item.recent24hCount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="text-xs font-extrabold uppercase text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-violet-500" />
            Abnormal Referral Activity ({data?.abnormalReferrals?.length ?? 0})
          </h4>
          {(data?.abnormalReferrals || []).length === 0 ? (
            <p className="text-[#777777] py-3">No abnormal referral bursts or abuse alerts.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(data?.abnormalReferrals || []).map((item) => (
                <div
                  key={item.referrerId}
                  className="p-2.5 rounded-xl bg-violet-50/60 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900"
                >
                  <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{item.referrerLabel}</p>
                  <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-400 mt-0.5">{item.reason}</p>
                  <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400">
                    Total: {item.totalReferrals} · 24h: {item.last24hCount} · Flagged: {item.flaggedCount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Flagged Referrals & Deletion Requests */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2">
          <h4 className="text-xs font-extrabold uppercase text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
            Suspicious Referral Alerts ({data?.flaggedReferrals.length ?? 0})
          </h4>
          {(data?.flaggedReferrals || []).length === 0 ? (
            <p className="text-[#777777] py-3">No suspicious referrals flagged.</p>
          ) : (
            (data?.flaggedReferrals || []).map((r) => (
              <div key={r.id} className="p-2.5 rounded-xl bg-red-50/60 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                <p className="font-bold">{r.referredEmail || r.referredUserId}</p>
                <p className="text-[11px] text-[#DC2626]">{r.suspiciousReason || 'Flagged for review'}</p>
              </div>
            ))
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2">
          <h4 className="text-xs font-extrabold uppercase text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-[#FF8500]" />
            Account Deletion Requests ({data?.deletionRequests.length ?? 0})
          </h4>
          {(data?.deletionRequests || []).length === 0 ? (
            <p className="text-[#777777] py-3">No account deletion requests.</p>
          ) : (
            (data?.deletionRequests || []).map((req) => (
              <div key={req.id} className="p-2.5 rounded-xl bg-[#F8FAFF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700">
                <p className="font-bold">{req.userEmail || req.userId}</p>
                <p className="text-[11px] text-[#777777]">{req.reason || 'No reason provided'} · {req.status}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 4. ACTIVITY & AUDIT LOGS PANEL
// =========================================================================

interface AdminActivityLogsPanelProps {
  lang: Language;
  auditLogs: AuditLog[];
}

export function AdminActivityLogsPanel({ lang, auditLogs }: AdminActivityLogsPanelProps) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const actions = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((l) => set.add(l.action));
    return Array.from(set).sort();
  }, [auditLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        (l.actorEmail || l.actorUid).toLowerCase().includes(q) ||
        (l.targetUserId || l.targetId).toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q) ||
        (l.summary || '').toLowerCase().includes(q) ||
        (l.transactionId || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, search, actionFilter]);

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search audit logs by admin, user ID, action, reason, or TX ID..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
        >
          <option value="all">All Actions ({auditLogs.length})</option>
          {actions.map((act) => (
            <option key={act} value={act}>
              {act}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">Date &amp; Time</th>
                <th className="py-3 px-4 font-bold">Admin</th>
                <th className="py-3 px-4 font-bold">Action</th>
                <th className="py-3 px-4 font-bold">Target</th>
                <th className="py-3 px-4 font-bold">Previous → New</th>
                <th className="py-3 px-4 font-bold">Reason / Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#777777]">
                    No activity logs found.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 150).map((log) => (
                  <tr key={log.id} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 whitespace-nowrap text-[#777777] dark:text-slate-400">
                      {formatDateShort(log.createdAt, lang)}
                    </td>
                    <td className="py-3 px-4 font-mono-num">
                      <p className="font-bold text-[#172033] dark:text-slate-100">{log.actorEmail || log.actorUid}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num font-bold text-[10px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono-num text-[11px]">
                      {log.targetUserId || log.targetId}
                      {log.transactionId ? (
                        <p className="text-[10px] text-[#FF8500]">TX: {log.transactionId}</p>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-[11px]">
                      {log.previousValue || log.newValue ? (
                        <span>
                          {log.previousValue || '—'} → <strong>{log.newValue || '—'}</strong>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-[#777777] dark:text-slate-300 max-w-sm">
                      <p className="font-semibold text-[#172033] dark:text-slate-200">{log.reason || log.summary}</p>
                      {log.reason && log.summary && log.summary !== log.reason && (
                        <p className="text-[10px] text-[#777777]">{log.summary}</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 5. PRESERVED STOREFRONT & ORDERS WORKSPACE PANEL
// =========================================================================

interface AdminStorefrontPanelProps {
  lang: Language;
  orders: Order[];
  payments: Payment[];
  products: Product[];
  categories: Category[];
  coupons: Coupon[];
  tickets: SupportTicket[];
  reviews: Review[];
  defaultSubTab?: 'orders' | 'payments' | 'products' | 'categories' | 'coupons' | 'tickets' | 'reviews';
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminStorefrontPanel({
  lang,
  orders,
  payments,
  products,
  categories,
  coupons,
  tickets,
  reviews,
  defaultSubTab,
  onSuccess,
  onError,
}: AdminStorefrontPanelProps) {
  const [subTab, setSubTab] = useState<'orders' | 'payments' | 'products' | 'categories' | 'coupons' | 'tickets' | 'reviews'>(
    defaultSubTab || 'orders'
  );
  useEffect(() => {
    if (defaultSubTab) setSubTab(defaultSubTab);
  }, [defaultSubTab]);
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [prodSearch, setProdSearch] = useState('');

  // Quick Add Product
  const [newProdTitle, setNewProdTitle] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('100');
  const [newProdCat, setNewProdCat] = useState(categories[0]?.id || 'cat_gaming');

  // Quick Add Category
  const [newCatName, setNewCatName] = useState('');

  // Quick Add Coupon
  const [couponCode, setCouponCode] = useState('');
  const [couponVal, setCouponVal] = useState('25');
  const [couponType, setCouponType] = useState<'fixed' | 'percent'>('fixed');
  const [couponMin, setCouponMin] = useState('100');

  const pendingPayments = payments.filter((p) => p.status === 'Verification Pending');
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress');

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.titleEn.toLowerCase().includes(q) ||
        p.titleBn.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [products, prodSearch]);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['orders', `Orders (${orders.length})`],
            ['payments', `Order Payments (${pendingPayments.length} pending)`],
            ['products', `Products (${products.length})`],
            ['categories', `Categories (${categories.length})`],
            ['coupons', `Coupons (${coupons.length})`],
            ['tickets', `Support Tickets (${openTickets.length} open)`],
            ['reviews', `Reviews (${reviews.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-3 py-1.5 rounded-xl font-bold border ${
              subTab === id
                ? 'bg-[#FF8500] text-white border-[#FF8500]'
                : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'orders' && (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
              No customer orders yet.
            </div>
          ) : (
            orders.map((ord) => (
              <div
                key={ord.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-[#172033] dark:text-slate-100">
                      #{ord.orderNumber} · {ord.productTitleEn || ord.productTitleBn}{' '}
                      <span className="text-[#FF8500] font-mono-num">৳{ord.totalPriceBdt}</span>
                    </p>
                    <p className="text-[11px] font-mono-num text-[#777777]">
                      Customer: {ord.customerName || ord.customerEmail || ord.customerId} · {ord.paymentMethod.toUpperCase()} ·{' '}
                      {formatDateShort(ord.createdAt, lang)}
                    </p>
                    {ord.deliveryNote && (
                      <p className="text-[11px] text-[#172033] dark:text-slate-300 mt-0.5">
                        Delivery Info: {ord.deliveryNote}
                      </p>
                    )}
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">
                    {ord.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
                  <input
                    type="text"
                    value={orderNotes[ord.id] ?? ord.adminNote ?? ''}
                    onChange={(e) => setOrderNotes({ ...orderNotes, [ord.id]: e.target.value })}
                    placeholder="Delivery credentials / admin note..."
                    className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                  <select
                    value={ord.status}
                    onChange={async (e) => {
                      try {
                        await adminUpdateOrderStatus(ord, e.target.value as OrderStatus, orderNotes[ord.id]);
                        onSuccess(`Order #${ord.orderNumber} updated to ${e.target.value}.`);
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'Status update failed.');
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
                  >
                    {[
                      'Pending Payment',
                      'Verification Pending',
                      'Paid',
                      'Payment Approved',
                      'Processing',
                      'Completed',
                      'Rejected',
                      'Cancelled',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {ord.status !== 'Completed' && ord.status !== 'Cancelled' && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await adminCompleteOrderWithRewardsServer(ord.id, orderNotes[ord.id]);
                          onSuccess(
                            `Order #${ord.orderNumber} completed (Cashback: ৳${res.awardedCashbackBdt}, Referral: ৳${res.awardedReferralBdt}).`
                          );
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Completion failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Complete + Rewards
                    </button>
                  )}
                  {ord.status !== 'Cancelled' && ord.status !== 'Completed' && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminRefundAndCancelOrderServer({
                            orderId: ord.id,
                            rejectionReason: orderNotes[ord.id] || 'Cancelled by admin',
                            refundToWallet: true,
                          });
                          onSuccess(`Order #${ord.orderNumber} cancelled & refunded.`);
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Refund failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold inline-flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancel &amp; Refund
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'payments' && (
        <div className="space-y-3">
          {payments.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
              No order payments submitted.
            </div>
          ) : (
            payments.map((pay) => (
              <div
                key={pay.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <p className="font-bold text-[#172033] dark:text-slate-100">
                    {pay.method.toUpperCase()} · <span className="font-mono-num">{pay.transactionId}</span> · ৳{pay.amountBdt}
                  </p>
                  <p className="text-[11px] font-mono-num text-[#777777]">
                    Order #{pay.orderNumber || pay.orderId} · Sender: {pay.senderNumber} · Status: <strong>{pay.status}</strong>
                  </p>
                </div>
                {pay.status === 'Verification Pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminVerifyPaymentServer({ payment: pay, decision: 'approve', nextOrderStatus: 'Processing' });
                        onSuccess(`Payment ${pay.transactionId} approved.`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await adminVerifyPaymentServer({
                          payment: pay,
                          decision: 'reject',
                          rejectionReason: 'Transaction could not be verified',
                        });
                        onSuccess(`Payment ${pay.transactionId} rejected.`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-50 text-[#DC2626] font-bold"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'products' && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newProdTitle.trim()) return;
              await adminSaveProduct(
                {
                  id: generateId('prod'),
                  categoryId: newProdCat,
                  titleEn: newProdTitle.trim(),
                  titleBn: newProdTitle.trim(),
                  descriptionEn: newProdTitle.trim(),
                  descriptionBn: newProdTitle.trim(),
                  priceBdt: Math.max(1, Math.round(Number(newProdPrice) || 100)),
                  availability: 'in_stock',
                  deliveryDurationEn: '5–15 minutes',
                  deliveryDurationBn: '৫–১৫ মিনিট',
                  imageUrl: '/assets/products/prod_ff_bd_diamonds.jpg',
                  active: true,
                },
                true
              );
              setNewProdTitle('');
              onSuccess('Product created.');
            }}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-4 gap-2"
          >
            <input
              type="text"
              required
              value={newProdTitle}
              onChange={(e) => setNewProdTitle(e.target.value)}
              placeholder="New product title *"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <select
              value={newProdCat}
              onChange={(e) => setNewProdCat(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={newProdPrice}
              onChange={(e) => setNewProdPrice(e.target.value)}
              placeholder="Price (BDT)"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
            <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold">
              + Add Product
            </button>
          </form>

          <input
            type="text"
            value={prodSearch}
            onChange={(e) => setProdSearch(e.target.value)}
            placeholder="Filter products..."
            className="w-full max-w-md px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredProducts.slice(0, 40).map((p) => (
              <div
                key={p.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-3.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                    <Package className="w-3.5 h-3.5 inline mr-1 text-[#FF8500]" />
                    {p.titleEn}
                  </p>
                  <p className="font-mono-num text-[11px] text-[#777777]">
                    ৳{p.priceBdt} · {p.availability} · {p.active ? 'Visible' : 'Hidden'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await adminQuickUpdatePackage(p, { active: !p.active });
                      onSuccess(`${p.titleEn} ${!p.active ? 'enabled' : 'hidden'}.`);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold"
                  >
                    {p.active ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await adminDeleteProduct(p.id);
                      onSuccess(`Deleted ${p.titleEn}.`);
                    }}
                    className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'categories' && (
        <div className="space-y-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newCatName.trim()) return;
              const slug = newCatName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
              await adminSaveCategory(
                {
                  id: generateId('cat'),
                  slug,
                  nameEn: newCatName.trim(),
                  nameBn: newCatName.trim(),
                  sortOrder: categories.length + 1,
                  active: true,
                },
                true
              );
              setNewCatName('');
              onSuccess('Category added.');
            }}
            className="flex gap-2 max-w-md"
          >
            <input
              type="text"
              required
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="New category name"
              className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800"
            />
            <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold">
              + Add
            </button>
          </form>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {categories.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-3 flex items-center justify-between"
              >
                <span className="font-bold">{c.nameEn}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await adminDeleteCategory(c.id);
                    onSuccess(`Category ${c.nameEn} deleted.`);
                  }}
                  className="text-[#DC2626] p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'coupons' && (
        <div className="space-y-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!couponCode.trim()) return;
              await adminSaveCoupon(
                {
                  id: generateId('cpn'),
                  code: couponCode.trim().toUpperCase(),
                  discountType: couponType,
                  discountValue: Math.max(1, Number(couponVal) || 10),
                  minOrderBdt: Math.max(0, Number(couponMin) || 0),
                  usageLimit: 500,
                  usedCount: 0,
                  active: true,
                },
                true
              );
              setCouponCode('');
              onSuccess('Coupon created.');
            }}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 grid grid-cols-2 sm:grid-cols-5 gap-2"
          >
            <input
              type="text"
              required
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="CODE *"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num uppercase"
            />
            <select
              value={couponType}
              onChange={(e) => setCouponType(e.target.value as 'fixed' | 'percent')}
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              <option value="fixed">Fixed (৳)</option>
              <option value="percent">Percent (%)</option>
            </select>
            <input
              type="number"
              min={1}
              value={couponVal}
              onChange={(e) => setCouponVal(e.target.value)}
              placeholder="Discount"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
            <input
              type="number"
              min={0}
              value={couponMin}
              onChange={(e) => setCouponMin(e.target.value)}
              placeholder="Min Order"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
            <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold">
              + Coupon
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {coupons.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-3 flex items-center justify-between"
              >
                <div>
                  <p className="font-mono-num font-extrabold text-[#FF8500] flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" />
                    {c.code}
                  </p>
                  <p className="text-[11px] text-[#777777]">
                    {c.discountType === 'percent' ? `${c.discountValue}%` : `৳${c.discountValue}`} off · Min ৳{c.minOrderBdt}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await adminDeleteCoupon(c.id);
                    onSuccess(`Coupon ${c.code} deleted.`);
                  }}
                  className="text-[#DC2626] p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'tickets' && (
        <div className="space-y-3">
          {tickets.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
              No support tickets.
            </div>
          ) : (
            tickets.map((tk) => (
              <div
                key={tk.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-[#FF8500]" />
                      {tk.subject}
                    </p>
                    {tk.category && (
                      <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] font-bold uppercase text-[10px]">
                        {tk.category}
                      </span>
                    )}
                    {tk.orderNumber && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num text-[10px]">
                        #{tk.orderNumber}
                      </span>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold uppercase text-[10px]">
                    {tk.status}
                  </span>
                </div>
                <p className="text-[#777777] dark:text-slate-300">{tk.message}</p>
                {tk.screenshotDataUrl && (
                  <a
                    href={tk.screenshotDataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-xl overflow-hidden border border-[#E6ECFA] dark:border-slate-700 hover:border-[#FF8500]"
                  >
                    <img
                      src={tk.screenshotDataUrl}
                      alt="Ticket screenshot"
                      className="max-h-40 w-auto object-contain bg-slate-50 dark:bg-slate-950"
                    />
                  </a>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ticketReplies[tk.id] ?? tk.adminReply ?? ''}
                    onChange={(e) => setTicketReplies({ ...ticketReplies, [tk.id]: e.target.value })}
                    placeholder="Write support reply..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await adminReplyTicket(tk, 'resolved', ticketReplies[tk.id] || 'Resolved by support');
                      onSuccess(`Replied & resolved ticket "${tk.subject}".`);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                  >
                    Reply &amp; Resolve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'reviews' && (
        <div className="space-y-2.5">
          {reviews.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
              No customer reviews submitted.
            </div>
          ) : (
            reviews.map((rev) => (
              <div
                key={rev.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-bold flex items-center gap-1.5">
                    {rev.authorName}
                    <span className="text-[#FF8500] inline-flex items-center gap-0.5">
                      <Star className="w-3 h-3 fill-current" />
                      {rev.rating}/5
                    </span>
                  </p>
                  <p className="text-[#777777] dark:text-slate-400">{rev.comment}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await adminToggleReviewApproval(rev.id, !rev.approved);
                      onSuccess(`Review ${!rev.approved ? 'approved' : 'hidden'}.`);
                    }}
                    className={`px-3 py-1 rounded-lg font-bold ${
                      rev.approved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {rev.approved ? 'Approved' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await adminDeleteReview(rev.id);
                      onSuccess('Review deleted.');
                    }}
                    className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
