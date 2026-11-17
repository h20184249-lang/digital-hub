# DIGITAL HUB — সম্পূর্ণ ওয়েবসাইট ডিজাইন ও ডেভেলপমেন্ট ব্রিফ
## Google AI Studio-তে দেওয়ার জন্য Master Project Specification

**প্রকল্প:** DIGITAL HUB  
**লক্ষ্য:** MangoTopUp-এর মতো সহজ, পূর্ণাঙ্গ ডিজিটাল পণ্য ও সার্ভিস কেনাবেচার অভিজ্ঞতা তৈরি করা—নিজস্ব ব্র্যান্ডিং, নিজস্ব পণ্য, নিজস্ব মূল্য, নিজস্ব অর্ডার ও নিরাপদ অ্যাডমিন ব্যবস্থাসহ।

---

# Google AI Studio-র জন্য প্রধান নির্দেশনা

তুমি আমার বিদ্যমান DIGITAL HUB ওয়েবসাইট/প্রজেক্ট আপডেট করবে। নতুন আলাদা demo website তৈরি করবে না। আগে বিদ্যমান project structure, framework, authentication, database, routes এবং working features পরীক্ষা করবে। তারপর বর্তমান architecture বজায় রেখে নিচের specification বাস্তবায়ন করবে।

**অত্যন্ত গুরুত্বপূর্ণ:**
1. কোনো working feature, database record, login, registration, payment flow বা existing order মুছে ফেলবে না।
2. আগে project-এর বর্তমান অবস্থা বুঝবে; তারপর পরিকল্পিতভাবে পরিবর্তন করবে।
3. শুধু UI mockup নয়—যেখানে backend/database দরকার সেখানে বাস্তব integration করবে।
4. কোনো package, price, stock, order বা payment success বানিয়ে দেখাবে না। বাস্তব তথ্য না থাকলে Admin Dashboard থেকে যোগ না করা পর্যন্ত পণ্যকে “Coming Soon” বা “Unavailable” দেখাবে।
5. MangoTopUp-কে কেবল public user experience ও ordering workflow-এর reference হিসেবে ধরবে। তাদের private database, proprietary code, private assets বা অনুমতি ছাড়া ব্যবহারযোগ্য নয় এমন content কপি করবে না।
6. সব লেখা, বাটন, ফর্ম, ফিল্টার ও checkout বাস্তবে কাজ করতে হবে। কোনো dead button বা fake checkout থাকবে না।
7. কাজ শেষে build/test চালিয়ে error ঠিক করবে এবং কোন কোন feature সম্পন্ন হয়েছে তার সংক্ষিপ্ত রিপোর্ট দেবে।

---

# ১. ওয়েবসাইটের সামগ্রিক ডিজাইন

- Premium, modern, trustworthy digital marketplace look।
- Mobile-first responsive design; Android, iPhone, tablet ও desktop-এ ঠিকভাবে কাজ করবে।
- পরিষ্কার typography, consistent spacing, সুন্দর product cards, subtle animations ও দ্রুত loading।
- Header-এ DIGITAL HUB logo, Home, Categories, Orders, Support, Login/Profile থাকবে।
- Mobile-এ compact navigation বা bottom navigation ব্যবহার করা যেতে পারে।
- Home page-এ Hero banner, Search, Popular Categories, Featured Products, Best Sellers, Special Offers, How to Order, Payment Methods ও Support section থাকবে।
- Light/Dark theme থাকলে উভয় theme-এ readable contrast নিশ্চিত করবে।
- কোনো অতিরিক্ত animation বা heavy image দিয়ে website ধীর করবে না।
- Accessible buttons, readable labels, keyboard navigation এবং image alt text যোগ করবে।

# ২. Product Category ও প্রাথমিক Catalog

নিচের তালিকা হলো DIGITAL HUB-এ বিবেচনার জন্য category/product catalogue। এগুলো সব এখনই বিক্রির জন্য active করবে না। Admin প্রতিটি product, package, price, region, stock ও availability যাচাই করে publish করবে। যেসব পণ্য বাস্তবে সরবরাহ করার অনুমতি/সক্ষমতা নেই, সেগুলো বিক্রির জন্য চালু করবে না।

## A. Gaming Top-Up
- Free Fire Diamonds
- Free Fire Weekly Membership
- Free Fire Monthly Membership
- Free Fire Weekly Lite
- Free Fire Level Up Pass
- Free Fire Likes
- Free Fire Indonesia UID Top-Up (যদি বাস্তব supplier থাকে)
- PUBG Mobile UC
- eFootball Coins / Points
- Roblox Robux
- EA SPORTS FC Mobile Coins / Packs
- Dream League Soccer (DLS) currency/top-up
- Clash of Clans
- Clash Royale
- UniPin / supported game vouchers
- অন্যান্য যাচাইকৃত game top-up

প্রতিটি game product-এ প্রয়োজনমতো Player ID, Server, Region, Zone ID বা Nickname field থাকবে। সব game-এ একই ফর্ম ব্যবহার করবে না; product অনুযায়ী required field Admin configure করতে পারবে।

## B. Social Media Services
- Telegram Premium
- Telegram Stars
- Facebook-related services
- TikTok-related services
- YouTube-related services
- Instagram-related services

প্রতিটি service-এর ক্ষেত্রে platform policy ও বৈধ delivery method অনুসরণ করতে হবে। Fake engagement, bot activity, password সংগ্রহ বা platform rules ভঙ্গ করে এমন service চালু করবে না। যেখানে শুধু username/profile URL প্রয়োজন, সেখানে password চাইবে না।

## C. Streaming & Entertainment Subscriptions
- Netflix
- Amazon Prime Video
- Chorki
- Crunchyroll
- GoodShorts
- অন্যান্য বৈধভাবে সরবরাহযোগ্য streaming subscription

Shared account বা region restriction থাকলে তা product details-এ পরিষ্কারভাবে উল্লেখ করতে হবে। অনুমতি ছাড়া account credentials বা অবৈধ access বিক্রি করা যাবে না।

## D. AI Services
- ChatGPT plans
- Google Gemini plans
- Claude plans
- Perplexity plans
- Grok plans
- অন্যান্য AI tools

শুধু বৈধ subscription, authorized reseller বা অনুমোদিত delivery model থাকলে product publish করবে। Official service-এর নাম ব্যবহার করলেও affiliation আছে এমন দাবি করবে না।

## E. Design & Productivity Software
- Canva
- Adobe Photoshop
- Adobe Illustrator
- Adobe Premiere Pro
- Adobe Lightroom
- Microsoft Office / Microsoft 365
- Windows License
- Internet Download Manager
- Antivirus software
- অন্যান্য বৈধ software license

License type, device limit, validity, region এবং activation method স্পষ্টভাবে দেখাবে।

## F. Gift Cards & Vouchers
- Google Play Gift Card
- Apple Gift Card
- Steam Gift Card
- Roblox Gift Card
- PlayStation Gift Card
- Xbox Gift Card
- Razer Gold
- অন্যান্য supported voucher

Gift card-এর currency/region, denomination, delivery type এবং redeem restrictions অবশ্যই দেখাবে। Region mismatch হলে purchase আটকাবে বা সতর্ক করবে।

## G. Website & Creative Services
- Domain Registration
- Web Hosting
- SSL Certificate
- Website Design
- Logo Design
- Banner Design
- Thumbnail Design
- Video Editing
- Digital Templates
- অন্যান্য custom creative service

Custom service-এ requirement form, reference upload, delivery estimate এবং revision policy থাকবে।

## H. VPN & Digital Utilities
- বৈধ VPN subscription plans
- অন্যান্য অনুমোদিত digital utilities

---

# ৩. Original Brand Logo ও Product Image — বাধ্যতামূলক নিয়ম

প্রতিটি product-এর নিজস্ব brand-appropriate image থাকবে। Telegram-এর কার্ডে Telegram-এর official logo, Netflix-এর কার্ডে Netflix-এর official logo, Free Fire-এর কার্ডে Free Fire-এর authentic artwork—এভাবে প্রতিটি platform-এর সঠিক asset ব্যবহার করবে।

**Image sourcing priority:**
1. Brand-এর official press/media/brand asset page।
2. Official app listing বা official product page থেকে ব্যবহারযোগ্য image।
3. অনুমোদিত/বিশ্বস্ত brand asset library।
4. এগুলো না পেলে neutral text/icon fallback; ভুল বা fake logo নয়।

**প্রতিটি image-এর জন্য:**
- Product-specific image mapping থাকবে; এক product-এর image অন্য product-এ reuse করবে না।
- Original aspect ratio বজায় রাখবে; stretch বা distort করবে না।
- Product logo ও promotional artwork আলাদা field হিসেবে সংরক্ষণ করতে পারবে।
- Image URL বা uploaded file-এর source, alt text এবং fallback থাকবে।
- Broken image হলে fallback দেখাবে; broken image icon নয়।
- Copyright/trademark এবং brand usage guideline মেনে চলবে।
- Official asset পাওয়া যায়নি এমন product-এ “Official image unavailable” admin notice থাকবে; AI-generated fake brand logo বানাবে না।
- bKash, Nagad ও Rocket payment section-এ সঠিক official logo ব্যবহার করবে; logo বিকৃত করবে না।

**Admin image management:**
- Admin product logo, banner ও gallery image upload/replace করতে পারবে।
- Image preview, crop/fit option এবং alt text থাকবে।
- Upload validation: file type, size limit, safe storage।
- Public users image upload বা product image change করতে পারবে না।

---

# ৪. Home Page ও Navigation

Home page-এর প্রস্তাবিত section:
1. Header / Logo / Search / Account
2. Hero banner ও primary CTA
3. Search products
4. Popular Categories
5. Featured / Best Selling products
6. Gaming Top-Up
7. Premium Subscriptions
8. Social Media & AI Services
9. Gift Cards & Software
10. Special Offers (শুধু বাস্তব offer থাকলে)
11. How to Order — ৩/৪টি সহজ ধাপ
12. Payment Methods
13. FAQ
14. Telegram/WhatsApp Support
15. Footer: About, Terms, Privacy, Refund Policy, Contact

Category menu থেকে user category page-এ যাবে। Search-এ product name, category ও keyword দিয়ে খুঁজতে পারবে।

---

# ৫. Product Card ও Product Details Page

## Product Card-এ দেখাবে
- সঠিক logo/product image
- Product name
- Short description
- “Starting from” price—শুধু package price বাস্তবে configure করা থাকলে
- Availability badge: Available / Out of Stock / Coming Soon
- View Details / Buy Now button

## Product Details Page-এ দেখাবে
- Product logo ও gallery
- Product title ও description
- Category ও region/server (যদি প্রযোজ্য)
- Package/variant selection
- প্রতিটি package-এর price, validity, features ও stock
- Delivery method ও estimated delivery time
- Required customer information fields
- Terms & Conditions
- Refund/cancellation policy
- FAQ
- Quantity (যেখানে প্রযোজ্য)
- Dynamic order summary ও total price
- Buy Now / Continue to Checkout

Package না বাছলে checkout করা যাবে না। Out-of-stock package কেনা যাবে না।

---

# ৬. Dynamic Package Management

প্রতিটি product-এর এক বা একাধিক package থাকবে। উদাহরণ হিসেবে শুধু UI test data ব্যবহার করা যাবে; demo price-কে real price হিসেবে প্রকাশ করা যাবে না।

Admin configure করতে পারবে:
- Package name
- Package description
- Price in BDT
- Validity/duration
- Region/server
- Stock quantity অথবা unlimited stock
- Delivery type
- Required fields
- Package status: Active / Inactive / Out of Stock
- Display order
- Optional sale price ও offer period

User package নির্বাচন করলে price ও total সঙ্গে সঙ্গে update হবে। Backend-এ checkout-এর সময় price আবার যাচাই করবে; frontend-এর পাঠানো price বিশ্বাস করবে না।

---

# ৭. Product-specific Order Form

সব product-এ একই input field দেখাবে না। Admin product অনুযায়ী required fields configure করতে পারবে।

**Gaming top-up:**
- Player ID / UID
- Server / Region
- প্রয়োজন হলে in-game name
- নির্বাচিত package

**Telegram Premium / Stars:**
- Telegram username বা প্রয়োজনীয় account identifier
- নির্বাচিত plan/duration/quantity
- delivery instructions
- কখনো Telegram password চাইবে না

**Social media service:**
- Profile / post / channel URL
- Quantity বা package
- Public/private account requirement
- Service-specific conditions

**Gift cards:**
- Country/region
- Currency
- Denomination
- Delivery email বা delivery method (যদি প্রয়োজন হয়)

**Subscription:**
- Plan/duration
- Region
- Delivery method
- প্রয়োজনীয় ন্যূনতম তথ্য
- Password সংগ্রহ না করে নিরাপদ activation/invitation method অগ্রাধিকার দেবে

**Custom design/video service:**
- Brief / instructions
- Reference file upload
- Preferred size/format
- Deadline preference
- Contact method

Form validation, helpful error message এবং confirmation screen থাকতে হবে।

---

# ৮. Checkout ও Payment System

Checkout steps:
1. User login/register করবে।
2. Product ও package নির্বাচন করবে।
3. প্রয়োজনীয় product-specific information দেবে।
4. Order summary দেখবে।
5. Payment method নির্বাচন করবে।
6. Payment instruction অনুসরণ করবে।
7. Payment reference/Transaction ID জমা দেবে।
8. Order submit হবে এবং unique Order ID তৈরি হবে।

**Payment methods:**
- bKash
- Nagad
- Rocket
- Wallet balance (যদি wallet backend নিরাপদভাবে implement করা থাকে)

Manual payment হলে:
- Admin-configured payment number দেখাবে।
- Payment amount, receiver number ও নির্দেশনা দেখাবে।
- Transaction ID input থাকবে।
- প্রয়োজন হলে receipt/screenshot upload থাকবে।
- Payment status: Unpaid / Submitted / Under Review / Verified / Rejected।
- Transaction ID duplicate কিনা backend-এ যাচাই করবে।
- Payment verified না হওয়া পর্যন্ত order-কে paid/completed দেখাবে না।

কোনো payment gateway/API connected না থাকলে “Automatic payment” দাবি করবে না। Manual verification স্পষ্টভাবে দেখাবে।

---

# ৯. Customer Account & Order Tracking

Customer dashboard-এ:
- Profile details
- My Orders
- Order ID
- Product/package
- Order date
- Payment status
- Fulfillment status
- Order details
- Support/contact option
- নিজের order history

Order status:
- Pending Payment
- Payment Submitted
- Payment Under Review
- Payment Verified
- Processing
- Completed
- Rejected
- Cancelled
- Refund Requested
- Refunded

Status change হলে order timeline-এ তারিখ/সময় ও update দেখাবে। User শুধু নিজের order দেখতে পারবে; অন্য user-এর order নয়।

---

# ১০. Admin Dashboard — শুধু Owner-এর জন্য

**Owner email:** ftake810@gmail.com

শুধু এই owner account-এর অনুমোদিত server-side role থাকলে admin dashboard access পাবে। শুধু email match বা frontend button hide করে security করা যাবে না।

**Security requirements:**
- Server-side authorization / trusted backend role check।
- Protected admin routes এবং API।
- Database security rules: public/customer write access নিষিদ্ধ।
- Customer নিজের profile-এর অনুমোদিত field এবং নিজের order read করতে পারবে।
- Customer অন্যের order, wallet, payment record বা admin data পড়তে/পরিবর্তন করতে পারবে না।
- Admin role শুধু trusted server/admin process থেকে assign হবে।
- Client-side code-এ secret key, service account credential বা admin password রাখা যাবে না।
- Admin actions audit log-এ সংরক্ষণ করবে।
- Login/session নিরাপদভাবে handle করবে।
- Unauthorized access হলে 403/Access Denied দেখাবে।
- Admin panel-এর URL জানলেও unauthorized user access পাবে না।

**Admin Dashboard modules:**
1. Overview / Analytics
2. Products
3. Categories
4. Packages & Pricing
5. Product Images / Banners
6. Inventory / Stock
7. Orders
8. Payment Verification
9. Customers / User Management
10. Wallet Management (শুধু নিরাপদ ledger system থাকলে)
11. Coupons / Discounts
12. Homepage Content
13. Support / Contact
14. Reports
15. Audit Logs
16. Website Settings

Admin product add/edit/delete, image upload, package price update, stock control, order process, payment verify/reject এবং banner update করতে পারবে।

**Admin visibility:** Public navigation, customer dashboard বা search result-এ Admin Dashboard link দেখাবে না। তবে security অবশ্যই backend-এ enforce করতে হবে।

---

# ১১. Order Fulfillment & Customer Support

- Admin order details দেখে fulfilment করবে।
- Manual fulfillment হলে admin status update করবে।
- Automated delivery কেবল supplier/API সত্যিই connected ও tested থাকলে চালু করবে।
- Supplier integration না থাকলে fake “instant delivery” দেখাবে না।
- Customer order page-এ support link থাকবে।
- Telegram/WhatsApp support URL admin settings থেকে configure হবে।
- Order issue/report করার option থাকবে।

---

# ১২. Database ও Data Model

বর্তমান database থাকলে সেটিই ব্যবহার করবে; আগে backup/migration plan করবে। প্রয়োজন অনুযায়ী নিচের entity/collection/table তৈরি বা map করবে:

**users**
- id, name, email, phone, role/customer status, createdAt

**categories**
- id, name, slug, description, image, active, sortOrder

**products**
- id, categoryId, name, slug, description, brand, logo, gallery, region, status, featured, createdAt, updatedAt

**packages**
- id, productId, name, description, price, salePrice, duration, region, stock, active, sortOrder

**product_fields**
- id, productId, fieldLabel, fieldKey, inputType, required, options, validationRules

**orders**
- id, orderNumber, userId, productId, packageId, quantity, customerInputs, subtotal, discount, total, paymentStatus, orderStatus, createdAt, updatedAt

**payments**
- id, orderId, method, amount, transactionId, receiptUrl, status, reviewedBy, reviewedAt

**order_events**
- id, orderId, status, note, actorId, createdAt

**site_settings**
- payment numbers, support URLs, logo, theme, homepage settings

**audit_logs**
- actorId, action, targetType, targetId, timestamp, safe metadata

সব database field বাস্তব schema ও framework অনুযায়ী adapt করবে। Password কখনো plain text-এ সংরক্ষণ করবে না। প্রয়োজন ছাড়া sensitive personal data সংগ্রহ করবে না।

---

# ১৩. Admin Pricing, Offers ও Refund Rules

- Admin নিজে BDT price set করবে।
- Price change হলে নতুন order-এ নতুন price প্রযোজ্য হবে; পুরনো order-এর snapshot price অপরিবর্তিত থাকবে।
- Coupon/discount-এর expiry ও usage limit থাকবে।
- Refund policy product type অনুযায়ী configurable হবে।
- Digital delivery সম্পন্ন হলে refund restriction থাকলে purchase-এর আগে স্পষ্টভাবে জানাবে।
- কোনো hidden fee থাকবে না; checkout-এর আগে total breakdown দেখাবে।

---

# ১৪. Performance, Reliability ও Safety

- Responsive image sizing ও lazy loading।
- প্রয়োজনমতো image compression।
- Loading, empty, error ও success states।
- Network failure হলে duplicate order তৈরি না করা।
- Server-side validation।
- Rate limiting / abuse protection যেখানে সম্ভব।
- Secure file upload validation।
- Database read/write permission পরীক্ষা।
- Payment ও order operations idempotent করার ব্যবস্থা।
- User input sanitize/validate করা।
- Console/build error ঠিক করা।
- Mobile browser-এ checkout পরীক্ষা করা।

---

# ১৫. Final Testing Checklist

কাজ শেষ হলে নিচের প্রতিটি ধাপ পরীক্ষা করবে:

1. Homepage ও category page ঠিকমতো load হয়।
2. প্রতিটি product-এর সঠিক brand image দেখা যায়।
3. Product details খুলে।
4. Package select করলে price update হয়।
5. Required field ছাড়া order submit হয় না।
6. Login ছাড়া protected checkout/order history access হয় না।
7. Payment method ও Transaction ID submit হয়।
8. Order database-এ unique ID-সহ save হয়।
9. Customer নিজের order দেখতে পারে।
10. Customer অন্যের order দেখতে পারে না।
11. Admin payment verify/reject করতে পারে।
12. Admin order status update করতে পারে।
13. Admin product/package/image/price manage করতে পারে।
14. Normal user admin route/API access করতে পারে না।
15. Database security rules unauthorized write block করে।
16. Broken image, dead button ও fake data নেই।
17. Android mobile এবং desktop-এ layout ঠিক থাকে।
18. Existing working features অক্ষত থাকে।

---

# ১৬. Google AI Studio-র কাজ করার নিয়ম

- প্রথমে বর্তমান project files ও architecture inspect করো।
- কী কী already working এবং কী কী missing—তা নির্ধারণ করো।
- একসঙ্গে সবকিছু ভেঙে নতুন করে না লিখে ছোট ছোট logical steps-এ implement করো।
- Existing backend/database থাকলে reuse করো।
- Backend বা database capability না থাকলে শুধু frontend দিয়ে secure payment/order/admin system হয়েছে বলে দাবি করবে না; প্রয়োজনীয় setup স্পষ্ট করে জানাবে।
- প্রতিটি stage-এর পর build/test চালাও।
- প্রয়োজনীয় secrets, API keys বা owner role setup-এর জন্য আমার কাছ থেকে input লাগলে নিরাপদভাবে জানাও; source code-এ secret hardcode করবে না।
- Final response-এ completed, pending এবং আমার যে setup করতে হবে—এই তিনটি আলাদা তালিকা দেবে।

**FINAL GOAL:** DIGITAL HUB হবে একটি সম্পূর্ণ, বিশ্বাসযোগ্য, premium digital marketplace—যেখানে গ্রাহক MangoTopUp-এর মতো সহজে product খুঁজবে, সঠিক package বেছে নেবে, নিজের প্রয়োজনীয় তথ্য দেবে, payment করবে, unique order ID পাবে এবং order status track করবে। Owner-only secure Admin Dashboard থেকে আমি products, original images, packages, prices, payments ও orders নিয়ন্ত্রণ করব।
