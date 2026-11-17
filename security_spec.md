# DIGITAL HUB — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Identity & RBAC Integrity**:
   - **MANDATORY OWNER-ONLY LOCK**: No user can self-register into `/admins/{adminId}` or elevate privileges.
   - **ONLY** the verified owner account (`request.auth.token.email_verified == true && request.auth.token.email == 'ftake810@gmail.com'`) can execute admin operations or read admin-restricted collections. No other user or `/admins/{uid}` document grants admin access.
2. **PII Isolation**:
   - `/users/{userId}` contains `email` and `phone`. Only the owning user (`request.auth.uid == userId`) or the verified owner admin (`isAdmin()`) may `get` or `list` user profiles.
3. **Order & Payment Integrity (Zero Auto-Approval)**:
   - Customers creating an order MUST set `customerId == request.auth.uid`, `status == 'Verification Pending'` (or `'Pending Payment'`), and `productId` must exist in `/products/{productId}`.
   - Customers CANNOT transition an order to `'Payment Approved'`, `'Processing'`, `'Completed'`, or `'Rejected'`. Customers can only cancel their own order while it is still `'Pending Payment'` or `'Verification Pending'`.
   - Duplicate Transaction IDs are blocked atomically via `/txRegistry/{txId}` (create-only, immutable, never overwritable).
   - Payment records in `/payments/{paymentId}` MUST be created with `status == 'Verification Pending'` and `customerId == request.auth.uid`. Only `isAdmin()` may transition a payment to `'Approved'` or `'Rejected'`.
4. **Terminal State Locking**:
   - Once an order reaches `'Completed'`, `'Rejected'`, or `'Cancelled'`, non-admin users cannot update it.
5. **Temporal Integrity & Path Hardening**:
   - All document IDs in single-doc operations validate `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
   - All `createdAt` / `updatedAt` timestamps on write use `request.time`.
6. **Public Catalog vs. Private Telemetry**:
   - `categories`, `products`, `advertisements`, `banners`, and `siteSettings` are publicly readable (no PII). All writes require `isAdmin()`.
   - `adClicks`, `adImpressions`, `auditLogs`, `referrals` cannot be read/listed by non-admins (except a user listing their own `referrals` where `resource.data.referrerId == request.auth.uid`).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Privilege Escalation**: Unprivileged signed-in user attempts `CREATE /admins/{uid}` with `{ uid, email, role: "super_admin" }`.
2. **Email Spoofing**: Unverified token (`email: "ftake810@gmail.com", email_verified: false`) attempts `CREATE /products/p1`.
3. **PII Blanket Read**: User A attempts `GET /users/{userB}` or `LIST /users`.
4. **Shadow Field Injection on User**: User A attempts `CREATE /users/{userA}` with extra ghost field `{ ..., isAdmin: true }`.
5. **Self-Approved Payment**: Customer attempts `CREATE /payments/pay1` with `status: "Approved"`.
6. **Self-Approved Order**: Customer attempts `UPDATE /orders/ord1` changing `status` to `"Completed"`.
7. **Duplicate TxID Overwrite**: Customer attempts `UPDATE /txRegistry/TX123` or `CREATE /txRegistry/TX123` when it already exists.
8. **Orphan Order Creation**: Customer attempts `CREATE /orders/ord2` referencing non-existent `productId: "non_existent_id"`.
9. **ID Poisoning**: Attacker attempts `CREATE /orders/../../evil_id_over_128_chars...`.
10. **Immutable Field Tampering**: Customer attempts `UPDATE /orders/ord1` modifying `customerId` or `createdAt` or `totalPriceBdt`.
11. **Customer Reading Other Customer Orders**: User A attempts `LIST /orders` without filtering `customerId == userA` (or `GET /orders/ord_of_userB`).
12. **Customer Modifying Site Payment Numbers**: Non-admin user attempts `UPDATE /siteSettings/global` to replace `bkashNumber` with attacker's number.
