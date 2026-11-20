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
  const isEfootballIphone = pid === 'prod_efootball_iphone' || bk === 'efootball_iphone';
  const isEfootballAndroid = pid === 'prod_efootball_coins' || bk === 'efootball_android' || bk === 'efootball';

  return {
    playerId: '',
    server: isIndo ? 'Indonesia' : 'BD Server (Bangladesh)',
    region: isEfootballIphone
      ? 'iPhone / iOS'
      : isEfootballAndroid
        ? 'Android'
        : bk === 'googleplay' || bk === 'apple'
          ? 'USA (USD)'
          : 'Global',
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
  lang: Language,
  product?: Product
): string | null {
  const bk = (product?.brandKey || '').toLowerCase();
  const pid = (product?.id || '').toLowerCase();

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
    const pidVal = values.playerId.trim();
    if (!pidVal || pidVal.length < 3) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে সঠিক Player ID / Konami ID / Tag লিখুন।'
        : 'Please enter a valid Player ID / Konami ID / Tag.';
    }
  } else if (formType === 'telegram') {
    const isMembers = pid === 'prod_smm_telegram_members';
    const handle = values.telegramUsername.trim().replace(/^@+/, '');
    if (!handle || handle.length < 3) {
      if (isMembers) {
        return lang === 'bn'
          ? 'অনুগ্রহ করে টেলিগ্রাম চ্যানেল বা গ্রুপের পাবলিক লিংক (t.me/...) বা @চ্যানেল লিখুন।'
          : 'Please enter a valid Telegram public channel/group link (t.me/...) or @channel.';
      }
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
    const target = values.profileUrl.trim();
    if (!target || target.length < 3) {
      return lang === 'bn'
        ? 'অনুগ্রহ করে সঠিক @ইউজারনেম, প্রোফাইল লিংক বা পোস্ট/ভিডিও লিংক দিন।'
        : 'Please provide a valid public @username, profile URL, or post/video link.';
    }
  } else if (formType === 'subscription') {
    const isVpn = bk === 'vpn' || pid === 'prod_sw_vpn_pro';
    const email = values.deliveryEmail.trim();
    if (!isVpn && (!email || !email.includes('@'))) {
      return lang === 'bn'
        ? 'অ্যাক্টিভেশন বা ইনভাইটের জন্য সঠিক ইমেইল লিখুন।'
        : 'Please provide a valid delivery email address.';
    }
    if (isVpn && email && !email.includes('@')) {
      return lang === 'bn'
        ? 'সঠিক ইমেইল দিন অথবা খালি রাখুন (WhatsApp-এ ডেলিভারি হবে)।'
        : 'Please enter a valid email address or leave it blank for WhatsApp delivery.';
    }
    if (!values.contactHandle.trim() || values.contactHandle.trim().length < 5) {
      return lang === 'bn'
        ? 'দ্রুত ডেলিভারির জন্য আপনার সঠিক WhatsApp নম্বর (01XXXXXXXXX) দিন।'
        : 'Please enter your active WhatsApp number (e.g. 01XXXXXXXXX) for fast delivery.';
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
  const bk = (product.brandKey || '').toLowerCase();
  const isEfootball =
    bk === 'efootball' ||
    bk === 'efootball_android' ||
    bk === 'efootball_iphone' ||
    product.id === 'prod_efootball_coins' ||
    product.id === 'prod_efootball_iphone';
  const parts: string[] = [];

  if (formType === 'freefire') {
    parts.push(`Player UID: ${values.playerId.trim()}`);
    parts.push(`Server: ${values.server}`);
    if (values.contactHandle.trim()) {
      parts.push(`WhatsApp: ${values.contactHandle.trim()}`);
    }
    parts.push(`Package: ${pkgLabel} x${quantity}`);
  } else if (formType === 'pubg_uid') {
    if (isEfootball) {
      parts.push(`eFootball ID: ${values.playerId.trim()}`);
      parts.push(`Platform: ${values.region}`);
    } else {
      parts.push(`Player ID/Tag: ${values.playerId.trim()}`);
      parts.push(`Region: ${values.region}`);
    }
    if (values.contactHandle.trim()) {
      parts.push(`WhatsApp: ${values.contactHandle.trim()}`);
    }
    parts.push(`Package: ${pkgLabel} x${quantity}`);
  } else if (formType === 'telegram') {
    const raw = values.telegramUsername.trim();
    if (/^https?:\/\//i.test(raw) || /^t\.me\//i.test(raw)) {
      parts.push(`Telegram Link: ${raw}`);
    } else {
      parts.push(`Telegram: @${raw.replace(/^@+/, '')}`);
    }
    parts.push(`Duration/Tier: ${pkgLabel} x${quantity}`);
  } else if (formType === 'giftcard') {
    parts.push(`Region: ${values.region}`);
    parts.push(`Denomination: ${pkgLabel} x${quantity}`);
    parts.push(`Delivery Email: ${values.deliveryEmail.trim()}`);
  } else if (formType === 'social') {
    parts.push(`Target Account/Link: ${values.profileUrl.trim()}`);
    parts.push(`Quantity/Tier: ${pkgLabel} x${quantity}`);
  } else if (formType === 'subscription') {
    if (values.deliveryEmail.trim()) {
      parts.push(`Delivery Email: ${values.deliveryEmail.trim()}`);
    }
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
  const pid = (product.id || '').toLowerCase();
  const isEfootball =
    bk === 'efootball' ||
    bk === 'efootball_android' ||
    bk === 'efootball_iphone' ||
    pid === 'prod_efootball_coins' ||
    pid === 'prod_efootball_iphone';
  const isAirdrop = bk === 'airdrop' || pid === 'prod_game_airdrop';
  const isTelegramMembers = pid === 'prod_smm_telegram_members';
  const isVpn = bk === 'vpn' || pid === 'prod_sw_vpn_pro';

  const playerLabel = (() => {
    if (bk === 'pubg') return lang === 'bn' ? 'PUBG ক্যারেক্টার ID *' : 'PUBG Character ID *';
    if (bk === 'efootball_iphone' || pid === 'prod_efootball_iphone') {
      return lang === 'bn' ? 'eFootball iPhone (iOS) Konami / Player ID *' : 'eFootball iPhone (iOS) Konami / Player ID *';
    }
    if (bk === 'efootball_android' || bk === 'efootball' || pid === 'prod_efootball_coins') {
      return lang === 'bn' ? 'eFootball Android Konami / Player ID *' : 'eFootball Android Konami / Player ID *';
    }
    if (bk === 'eafc') return lang === 'bn' ? 'EA FC Mobile প্লেয়ার UID *' : 'EA FC Mobile Player UID *';
    if (bk === 'dls') return lang === 'bn' ? 'DLS 2026 প্রোফাইল / টিম ID *' : 'DLS 2026 Profile / Team ID *';
    if (bk === 'roblox') return lang === 'bn' ? 'Roblox ইউজারনেম *' : 'Roblox Username *';
    if (bk === 'coc' || bk === 'clashroyale') return lang === 'bn' ? 'Supercell প্লেয়ার ট্যাগ (#...) *' : 'Supercell Player Tag (#...) *';
    if (bk === 'valorant') return lang === 'bn' ? 'Riot ID (Name#Tag) *' : 'Riot ID (Name#Tag) *';
    if (bk === 'genshin') return lang === 'bn' ? 'Genshin Impact UID *' : 'Genshin Impact UID *';
    if (bk === 'mlbb') return lang === 'bn' ? 'MLBB User ID (Zone ID) *' : 'MLBB User ID (Zone ID) *';
    return lang === 'bn' ? 'প্লেয়ার ID / ট্যাগ *' : 'Player ID / Tag / Riot ID *';
  })();

  const socialTargetLabel = (() => {
    if (bk === 'tiktok') {
      return lang === 'bn' ? 'TikTok @ইউজারনেম বা ভিডিও লিংক *' : 'TikTok @Username or Video URL *';
    }
    if (bk === 'facebook') {
      return lang === 'bn' ? 'Facebook পেজ / প্রোফাইল / পোস্ট লিংক *' : 'Facebook Page / Profile / Post Link *';
    }
    if (bk === 'instagram') {
      return lang === 'bn' ? 'Instagram @ইউজারনেম বা পোস্ট / রিল লিংক *' : 'Instagram @Username or Post / Reel Link *';
    }
    return lang === 'bn' ? 'প্রোফাইল @ইউজারনেম বা ভিডিও/পেজ লিংক *' : 'Public @Username or Profile / Post URL *';
  })();

  const socialPlaceholder = (() => {
    if (bk === 'tiktok') return '@your_tiktok or https://tiktok.com/@...';
    if (bk === 'facebook') return 'https://facebook.com/yourpage or post URL';
    if (bk === 'instagram') return '@your_instagram or https://instagram.com/p/...';
    return '@username or https://...';
  })();

  const subEmailLabel = (() => {
    if (isVpn) {
      return lang === 'bn' ? 'ইমেইল (ঐচ্ছিক — WhatsApp-এ ডেলিভারি পাবেন)' : 'Email Address (Optional — Delivered via WhatsApp)';
    }
    if (bk === 'chorki') {
      return lang === 'bn' ? 'Chorki ইমেইল (সাবস্ক্রিপশন ডেলিভারির জন্য) *' : 'Chorki Delivery Email *';
    }
    if (bk === 'crunchyroll') {
      return lang === 'bn' ? 'Crunchyroll ডেলিভারি ইমেইল *' : 'Crunchyroll Delivery Email *';
    }
    if (bk === 'chatgpt') {
      return lang === 'bn' ? 'ChatGPT ডেলিভারি / ইনভাইট ইমেইল *' : 'ChatGPT Activation / Delivery Email *';
    }
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
            ? 'নিরাপত্তা গ্যারান্টি: কোনো গেম বা সোশ্যাল মিডিয়া সার্ভিসের জন্যই আপনার ব্যক্তিগত পাসওয়ার্ড চাওয়া হয় না। শুধুমাত্র নিচের নির্দিষ্ট তথ্য দিন।'
            : 'Security Notice: DIGITAL HUB never asks for your game, email, or social media password.'}
        </span>
      </div>

      {formType === 'freefire' && (
        <div className="space-y-2.5">
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
          {isAirdrop && (
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'WhatsApp যোগাযোগ নম্বর (দ্রুত এয়ারড্রপ আপডেটের জন্য)' : 'WhatsApp Number (For Airdrop Delivery Updates)'}
              </label>
              <input
                type="text"
                value={values.contactHandle}
                onChange={(e) => setField('contactHandle', e.target.value)}
                placeholder="017XXXXXXXX"
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
              />
            </div>
          )}
        </div>
      )}

      {formType === 'pubg_uid' && (
        <div className="space-y-2.5">
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
                      : bk === 'roblox'
                        ? 'e.g. PlayerUsername'
                        : lang === 'bn'
                          ? 'সঠিক ID বা ইউজারনেম লিখুন'
                          : 'Enter exact ID or #Tag'
                }
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {isEfootball
                  ? lang === 'bn'
                    ? 'ডিভাইস প্ল্যাটফর্ম *'
                    : 'Device Platform *'
                  : lang === 'bn'
                    ? 'সার্ভার / রিজিয়ন *'
                    : 'Select Region *'}
              </label>
              {isEfootball ? (
                <select
                  value={values.region}
                  onChange={(e) => setField('region', e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
                >
                  <option value="Android">Android (Google Play)</option>
                  <option value="iPhone / iOS">iPhone / iOS (App Store)</option>
                </select>
              ) : (
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
              )}
            </div>
          </div>
          {(isEfootball || bk === 'dls') && (
            <div>
              <label className="block text-[11px] font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'WhatsApp নম্বর (ঐচ্ছিক — দ্রুত কনফার্মেশনের জন্য)' : 'WhatsApp Number (Optional — Fast Delivery Contact)'}
              </label>
              <input
                type="text"
                value={values.contactHandle}
                onChange={(e) => setField('contactHandle', e.target.value)}
                placeholder="017XXXXXXXX"
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
              />
            </div>
          )}
        </div>
      )}

      {formType === 'telegram' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {isTelegramMembers
                ? lang === 'bn'
                  ? 'টেলিগ্রাম চ্যানেল / গ্রুপ লিংক *'
                  : 'Telegram Channel / Group Link *'
                : lang === 'bn'
                  ? 'টেলিগ্রাম @ইউজারনেম *'
                  : 'Telegram @Username *'}
            </label>
            <input
              type="text"
              required
              value={values.telegramUsername}
              onChange={(e) => setField('telegramUsername', e.target.value)}
              placeholder={isTelegramMembers ? 'https://t.me/yourchannel or @channel' : '@your_telegram_username'}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-semibold focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'নির্বাচিত প্যাকেজ / মেয়াদ' : 'Selected Package / Duration'}
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
              {socialTargetLabel}
            </label>
            <input
              type="text"
              required
              value={values.profileUrl}
              onChange={(e) => setField('profileUrl', e.target.value)}
              placeholder={socialPlaceholder}
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
              required={!isVpn}
              value={values.deliveryEmail}
              onChange={(e) => setField('deliveryEmail', e.target.value)}
              placeholder="your.email@gmail.com"
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'WhatsApp নম্বর (দ্রুত ডেলিভারি) *' : 'WhatsApp Contact Number *'}
            </label>
            <input
              type="text"
              required
              value={values.contactHandle}
              onChange={(e) => setField('contactHandle', e.target.value)}
              placeholder={lang === 'bn' ? '017XXXXXXXX বা @username' : '017XXXXXXXX or @username'}
              className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
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
