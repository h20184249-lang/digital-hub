import { ChangeEvent, useState } from 'react';
import { Lock, ShieldCheck, Upload, X } from 'lucide-react';
import { Language, OrderFormType, Product, ProductPackage } from '../types/marketplace';
import { getProductOrderFormType } from '../lib/catalogHelpers';
import { compressImageToDataUrl } from '../lib/firestoreService';

export interface ServiceOrderFieldValues {
  playerId: string;
  server: string;
  region: string;
  telegramUsername: string;
  deliveryEmail: string;
  profileUrl: string;
  contactHandle: string;
  projectBrief: string;
  extraNote: string;
}

export function createInitialServiceOrderValues(
  userEmail = '',
  product?: Product
): ServiceOrderFieldValues {
  const bk = (product?.brandKey || '').toLowerCase();
  const pid = (product?.id || '').toLowerCase();
  const isIndo = pid === 'prod_ff_indo' || bk === 'freefire_indo';

  return {
    playerId: '',
    server: isIndo ? 'Indonesia' : 'BD Server (Bangladesh)',
    region: bk === 'googleplay' || bk === 'apple' ? 'USA (USD)' : 'Global',
    telegramUsername: '',
    deliveryEmail: userEmail,
    profileUrl: '',
    contactHandle: '',
    projectBrief: '',
    extraNote: '',
  };
}

export function validateServiceOrderValues(
  formType: OrderFormType,
  values: ServiceOrderFieldValues,
  lang: Language
): string | null {
  if (formType === 'freefire') {
    const uid = values.playerId.trim();
    if (!uid || uid.length < 5) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে সঠিক ফ্রি ফায়ার প্লেয়ার UID লিখুন (কমপক্ষে ৫ অক্ষর)।'
        : 'Please enter a valid Free Fire Player UID (minimum 5 characters).';
    }
    if (!values.server.trim()) {
      return lang === 'bn' ? 'অনুগ্রহ করে সার্ভার নির্বাচন করুন।' : 'Please select your game server.';
    }
  } else if (formType === 'pubg_uid') {
    const pid = values.playerId.trim();
    if (!pid || pid.length < 3) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে সঠিক Player ID / Tag লিখুন।'
        : 'Please enter a valid Player ID / Tag.';
    }
  } else if (formType === 'telegram') {
    const handle = values.telegramUsername.trim().replace(/^@+/, '');
    if (!handle || handle.length < 3) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে সঠিক টেলিগ্রাম @ইউজারনেম লিখুন।'
        : 'Please enter your Telegram @username.';
    }
  } else if (formType === 'giftcard') {
    const email = values.deliveryEmail.trim();
    if (!email || !email.includes('@')) {
      return lang === 'bn'
        ? 'রিডিম কোড ডেলিভারির জন্য একটি সঠিক ইমেইল দিন।'
        : 'Please enter a valid email address for gift card code delivery.';
    }
  } else if (formType === 'social') {
    const url = values.profileUrl.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://') && url.length < 5)) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে প্রোফাইল বা ভিডিওর সঠিক লিংক (URL) দিন।'
        : 'Please provide a valid public profile, channel, or video URL.';
    }
  } else if (formType === 'subscription') {
    const email = values.deliveryEmail.trim();
    if (!email || !email.includes('@')) {
      return lang === 'bn'
        ? 'অ্যাক্টিভেশন বা ইনভাইটের জন্য সঠিক ইমেইল লিখুন।'
        : 'Please provide a valid delivery email address.';
    }
    if (!values.contactHandle.trim()) {
      return lang === 'bn'
        ? 'দ্রুত ডেলিভারির জন্য WhatsApp বা Telegram নম্বর/ইউজারনেম দিন।'
        : 'Please enter your WhatsApp or Telegram contact for fast delivery.';
    }
  } else if (formType === 'design') {
    if (values.projectBrief.trim().length < 6) {
      return lang === 'bn'
        ? 'প্রজেক্ট বা ডিজাইনের বিস্তারিত নির্দেশনা লিখুন।'
        : 'Please enter your project requirements and specifications.';
    }
    const email = values.deliveryEmail.trim();
    if (!email || !email.includes('@')) {
      return lang === 'bn'
        ? 'ডেলিভারি ফাইলের জন্য সঠিক ইমেইল দিন।'
        : 'Please provide a valid email for deliverable delivery.';
    }
  }
  return null;
}

export function buildServiceDeliveryNote(
  formType: OrderFormType,
  values: ServiceOrderFieldValues,
  product: Product,
  selectedPackage: ProductPackage | undefined,
  quantity: number
): string {
  const pkgLabel = selectedPackage ? selectedPackage.nameEn : product.titleEn;
  const parts: string[] = [];

  if (formType === 'freefire') {
    parts.push(`Player UID: ${values.playerId.trim()}`);
    parts.push(`Server: ${values.server}`);
    parts.push(`Package: ${pkgLabel} x${quantity}`);
  } else if (formType === 'pubg_uid') {
    parts.push(`Player ID/Tag: ${values.playerId.trim()}`);
    parts.push(`Region: ${values.region}`);
    parts.push(`Package: ${pkgLabel} x${quantity}`);
  } else if (formType === 'telegram') {
    const cleanHandle = values.telegramUsername.trim().replace(/^@+/, '');
    parts.push(`Telegram: @${cleanHandle}`);
    parts.push(`Duration/Tier: ${pkgLabel} x${quantity}`);
  } else if (formType === 'giftcard') {
    parts.push(`Region: ${values.region}`);
    parts.push(`Denomination: ${pkgLabel} x${quantity}`);
    parts.push(`Delivery Email: ${values.deliveryEmail.trim()}`);
  } else if (formType === 'social') {
    parts.push(`Target URL: ${values.profileUrl.trim()}`);
    parts.push(`Quantity/Tier: ${pkgLabel} x${quantity}`);
  } else if (formType === 'subscription') {
    parts.push(`Delivery Email: ${values.deliveryEmail.trim()}`);
    parts.push(`WhatsApp/TG: ${values.contactHandle.trim()}`);
    parts.push(`Plan: ${pkgLabel} x${quantity}`);
  } else {
    parts.push(`Project Requirements: ${values.projectBrief.trim()}`);
    parts.push(`Contact/Email: ${values.deliveryEmail.trim()}`);
    parts.push(`Tier: ${pkgLabel} x${quantity}`);
  }

  if (values.extraNote.trim()) {
    parts.push(`Note: ${values.extraNote.trim()}`);
  }

  return parts.join(' | ').slice(0, 1180);
}

interface ServiceOrderFormFieldsProps {
  product: Product;
  selectedPackage?: ProductPackage;
  quantity: number;
  lang: Language;
  values: ServiceOrderFieldValues;
  onChange: (next: ServiceOrderFieldValues) => void;
  referenceAttachmentUrl?: string;
  onReferenceAttachmentChange?: (dataUrl: string) => void;
}

export function ServiceOrderFormFields({
  product,
  selectedPackage,
  quantity,
  lang,
  values,
  onChange,
  referenceAttachmentUrl,
  onReferenceAttachmentChange,
}: ServiceOrderFormFieldsProps) {
  const [attachedFileName, setAttachedFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const formType = getProductOrderFormType(product);
  const bk = (product.brandKey || '').toLowerCase();

  const playerLabel = (() => {
    if (bk === 'pubg') return lang === 'bn' ? 'PUBG ক্যারেক্টার ID *' : 'PUBG Character ID *';
    if (bk === 'efootball') return lang === 'bn' ? 'Konami / eFootball ID *' : 'Konami / eFootball Player ID *';
    if (bk === 'roblox') return lang === 'bn' ? 'Roblox ইউজারনেম *' : 'Roblox Username *';
    if (bk === 'coc' || bk === 'clashroyale') return lang === 'bn' ? 'Supercell প্লেয়ার ট্যাগ (#...) *' : 'Supercell Player Tag (#...) *';
    if (bk === 'valorant') return lang === 'bn' ? 'Riot ID (Name#Tag) *' : 'Riot ID (Name#Tag) *';
    if (bk === 'genshin') return lang === 'bn' ? 'Genshin Impact UID *' : 'Genshin Impact UID *';
    if (bk === 'mlbb') return lang === 'bn' ? 'MLBB User ID (Zone ID) *' : 'MLBB User ID (Zone ID) *';
    return lang === 'bn' ? 'প্লেয়ার ID / ট্যাগ *' : 'Player ID / Tag / Riot ID *';
  })();

  const subEmailLabel = (() => {
    if (bk === 'capcut') {
      return lang === 'bn'
        ? 'CapCut অ্যাকাউন্ট ইমেইল (Account Info) *'
        : 'CapCut Account Email (Account Info) *';
    }
    if (bk === 'canva') return lang === 'bn' ? 'ক্যানভা টিম ইনভাইট ইমেইল *' : 'Canva Account Email (For Team Invite) *';
    if (['photoshop', 'illustrator', 'premiere', 'lightroom', 'adobe'].includes(bk)) {
      return lang === 'bn' ? 'Adobe ID ডেলিভারি ইমেইল *' : 'Adobe ID Email (For License Invite) *';
    }
    if (['windows', 'office', 'microsoft', 'idm', 'antivirus'].includes(bk)) {
      return lang === 'bn' ? 'লাইসেন্স কী ডেলিভারি ইমেইল *' : 'License Key Delivery Email *';
    }
    return lang === 'bn' ? 'ডেলিভারি ইমেইল (ইনভাইট/লাইসেন্সের জন্য) *' : 'Delivery Email (For Invite / Key) *';
  })();

  const pkgName = selectedPackage
    ? lang === 'bn'
      ? selectedPackage.nameBn
      : selectedPackage.nameEn
    : lang === 'bn'
      ? product.titleBn
      : product.titleEn;

  const setField = <K extends keyof ServiceOrderFieldValues>(key: K, val: string) => {
    onChange({ ...values, [key]: val });
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onReferenceAttachmentChange) return;
    setUploadError('');
    try {
      const compressed = await compressImageToDataUrl(file, 960);
      setAttachedFileName(file.name);
      onReferenceAttachmentChange(compressed);
    } catch {
      setUploadError(
        lang === 'bn'
          ? 'ছবিটি প্রসেস করা যায়নি। অনুগ্রহ করে JPG/PNG ছবি ব্যবহার করুন।'
          : 'Could not process attachment. Please choose a valid JPG, PNG, or WebP image.'
      );
    }
  };

  return (
    <div className="space-y-3 p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-extrabold text-[#172033]">
          {lang === 'bn' ? 'সার্ভিস ডেলিভারি ও অ্যাকাউন্ট তথ্য' : 'Service Delivery Information'}
        </p>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#059669]">
          <Lock className="w-3 h-3" />
          {lang === 'bn' ? 'পাসওয়ার্ড প্রয়োজন নেই' : 'No Password Required'}
        </span>
      </div>

      {/* ZERO PASSWORD GUARANTEE */}
      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 leading-relaxed">
        <ShieldCheck className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" />
        <span>
          {lang === 'bn'
            ? 'নিরাপত্তা গ্যারান্টি: কোনো সার্ভিসের জন্যই আপনার ব্যক্তিগত পাসওয়ার্ড চাওয়া হয় না। শুধুমাত্র নিচের নির্দিষ্ট তথ্য দিন।'
            : 'Security Notice: DIGITAL HUB never asks for your email, social, or game password.'}
        </span>
      </div>

      {formType === 'freefire' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'ফ্রি ফায়ার প্লেয়ার UID *' : 'Free Fire Player UID *'}
            </label>
            <input
              type="text"
              required
              value={values.playerId}
              onChange={(e) => setField('playerId', e.target.value)}
              placeholder={lang === 'bn' ? 'যেমন: 2458910342' : 'e.g. 2458910342'}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'গেম সার্ভার নির্বাচন *' : 'Select Server *'}
            </label>
            <select
              value={values.server}
              onChange={(e) => setField('server', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
            >
              <option value="BD Server (Bangladesh)">Bangladesh (BD Server)</option>
              <option value="Indonesia">Indonesia (ID Server)</option>
              <option value="Singapore">Singapore (SG Server)</option>
              <option value="India">India (IND Server)</option>
              <option value="Global">Global Server</option>
            </select>
          </div>
        </div>
      )}

      {formType === 'pubg_uid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {playerLabel}
            </label>
            <input
              type="text"
              required
              value={values.playerId}
              onChange={(e) => setField('playerId', e.target.value)}
              placeholder={
                bk === 'valorant'
                  ? 'e.g. Player#1234'
                  : bk === 'coc' || bk === 'clashroyale'
                    ? 'e.g. #8PY2QL90'
                    : lang === 'bn'
                      ? 'সঠিক ID বা ইউজারনেম লিখুন'
                      : 'Enter exact ID or #Tag'
              }
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'সার্ভার / রিজিয়ন *' : 'Select Region *'}
            </label>
            <select
              value={values.region}
              onChange={(e) => setField('region', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
            >
              <option value="Global">Global</option>
              <option value="Asia">Asia / SEA</option>
              <option value="KR-JP">Korea / Japan</option>
              <option value="Middle East">Middle East</option>
              <option value="Europe">Europe</option>
              <option value="North America">North America</option>
            </select>
          </div>
        </div>
      )}

      {formType === 'telegram' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'টেলিগ্রাম @ইউজারনেম *' : 'Telegram @Username *'}
            </label>
            <input
              type="text"
              required
              value={values.telegramUsername}
              onChange={(e) => setField('telegramUsername', e.target.value)}
              placeholder="@your_telegram_username"
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-semibold focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'নির্বাচিত মেয়াদ / স্টার্স' : 'Selected Duration / Tier'}
            </label>
            <div className="px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#FF8500] truncate">
              {pkgName} × {quantity}
            </div>
          </div>
        </div>
      )}

      {formType === 'giftcard' && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'গিফট কার্ড রিজিয়ন *' : 'Card Region *'}
              </label>
              <select
                value={values.region}
                onChange={(e) => setField('region', e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
              >
                <option value="Global">Global Region</option>
                <option value="USA (USD)">USA (USD)</option>
                <option value="Bangladesh (BDT)">Bangladesh (BDT)</option>
                <option value="UK (GBP)">UK (GBP)</option>
                <option value="Turkey (TRY)">Turkey (TRY)</option>
                <option value="Europe (EUR)">Europe (EUR)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'কার্ড ডিনমিনেশন' : 'Card Denomination'}
              </label>
              <div className="px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#FF8500] truncate">
                {pkgName} × {quantity}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'ডেলিভারি ইমেইল (কোড পাওয়ার জন্য) *' : 'Delivery Email (To Receive Redeem Code) *'}
            </label>
            <input
              type="email"
              required
              value={values.deliveryEmail}
              onChange={(e) => setField('deliveryEmail', e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>
        </div>
      )}

      {formType === 'social' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'প্রোফাইল / ভিডিও / পেজ লিংক *' : 'Profile / Page / Video URL *'}
            </label>
            <input
              type="url"
              required
              value={values.profileUrl}
              onChange={(e) => setField('profileUrl', e.target.value)}
              placeholder="https://facebook.com/... or https://youtube.com/..."
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'পরিমাণ (Quantity)' : 'Selected Quantity'}
            </label>
            <div className="px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#FF8500] truncate">
              {pkgName} × {quantity}
            </div>
          </div>
        </div>
      )}

      {formType === 'subscription' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {subEmailLabel}
            </label>
            <input
              type="email"
              required
              value={values.deliveryEmail}
              onChange={(e) => setField('deliveryEmail', e.target.value)}
              placeholder="your.email@gmail.com"
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'WhatsApp বা Telegram যোগাযোগ *' : 'WhatsApp or Telegram Contact *'}
            </label>
            <input
              type="text"
              required
              value={values.contactHandle}
              onChange={(e) => setField('contactHandle', e.target.value)}
              placeholder={lang === 'bn' ? '017XXXXXXXX বা @username' : '017XXXXXXXX or @username'}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>
        </div>
      )}

      {formType === 'design' && (
        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'প্রজেক্টের বিবরণ / ডোমেইন / নির্দেশনা *' : 'Project Requirements & Specifications *'}
            </label>
            <textarea
              rows={3}
              required
              value={values.projectBrief}
              onChange={(e) => setField('projectBrief', e.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'ব্র্যান্ড নাম, কালার, সাইজ অথবা ডোমেইন নাম সম্পর্কে বিস্তারিত লিখুন...'
                  : 'Describe brand name, desired dimensions, domain name, style & deliverables...'
              }
              className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'ডেলিভারি ইমেইল *' : 'Delivery Email *'}
              </label>
              <input
                type="email"
                required
                value={values.deliveryEmail}
                onChange={(e) => setField('deliveryEmail', e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
              />
            </div>

            {onReferenceAttachmentChange && (
              <div>
                <label className="block text-[11px] font-bold text-[#172033] mb-1">
                  {lang === 'bn' ? 'রেফারেন্স ফাইল / স্যাম্পল (ঐচ্ছিক)' : 'Reference Image Upload (Optional)'}
                </label>
                {referenceAttachmentUrl ? (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-white border border-[#E6ECFA]">
                    <img
                      src={referenceAttachmentUrl}
                      alt="Reference preview"
                      className="w-10 h-10 rounded-lg object-cover border border-[#E6ECFA]"
                    />
                    <span className="text-[11px] font-bold text-[#059669] flex-1 truncate">
                      {attachedFileName || (lang === 'bn' ? 'ফাইল সংযুক্ত হয়েছে' : 'Attached')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachedFileName('');
                        setUploadError('');
                        onReferenceAttachmentChange('');
                      }}
                      className="p-1 rounded-lg bg-[#F3F6FF] text-[#777777] hover:text-[#DC2626]"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-dashed border-[#FF8500]/50 text-xs font-bold text-[#172033] hover:border-[#FF8500] cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                    <span>{lang === 'bn' ? 'ছবি আপলোড করুন' : 'Upload Reference'}</span>
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                )}
                {uploadError && (
                  <p className="text-[11px] font-semibold text-[#DC2626] mt-1">{uploadError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-semibold text-[#777777] mb-1">
          {lang === 'bn' ? 'অতিরিক্ত নোট (ঐচ্ছিক)' : 'Additional Note (Optional)'}
        </label>
        <input
          type="text"
          value={values.extraNote}
          onChange={(e) => setField('extraNote', e.target.value)}
          placeholder={
            lang === 'bn'
              ? 'কোনো বিশেষ নির্দেশনা থাকলে লিখুন...'
              : 'Any special instructions for our fulfillment team...'
          }
          className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
        />
      </div>
    </div>
  );
}
