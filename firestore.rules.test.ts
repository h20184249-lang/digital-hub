/**
 * DIGITAL HUB — Firestore Security Rules Adversarial Test Suite (Dirty Dozen)
 * Documents and verifies the 12 Zero-Trust Security Invariants from security_spec.md.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'get' | 'list' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Privilege Escalation into /admins',
    collection: 'admins',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Unprivileged user cannot write to /admins/{uid}; requires isAdmin().',
  },
  {
    id: 2,
    name: 'Unverified Email Spoofing Admin Write',
    collection: 'products',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isBootstrappedAdmin() mandates request.auth.token.email_verified == true.',
  },
  {
    id: 3,
    name: 'PII Blanket Read on /users',
    collection: 'users',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    rationale: 'Non-admin users cannot list /users or get another user document.',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on /users',
    collection: 'users',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isValidUserProfile enforces data.keys().hasOnly([...]) rejecting ghost fields.',
  },
  {
    id: 5,
    name: 'Self-Approved Payment Creation',
    collection: 'payments',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Customer payment create mandates incoming().status == "Verification Pending".',
  },
  {
    id: 6,
    name: 'Self-Approved Order Completion',
    collection: 'orders',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Customer order update only allows transitioning Pending/Verification Pending to Cancelled.',
  },
  {
    id: 7,
    name: 'Duplicate TxID Overwrite',
    collection: 'txRegistry',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'txRegistry forbids updates/deletes and requires !exists(...) on create.',
  },
  {
    id: 8,
    name: 'Orphan Order Referencing Missing Product',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'Order create requires exists(/databases/$(database)/documents/products/$(incoming().productId)).',
  },
  {
    id: 9,
    name: 'ID Poisoning (>128 chars or path traversal)',
    collection: 'orders',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    rationale: 'isValidId(orderId) rejects IDs failing ^[a-zA-Z0-9_\\-]+$ or > 128 chars.',
  },
  {
    id: 10,
    name: 'Immutable Order Field Tampering',
    collection: 'orders',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'customerId, productId, totalPriceBdt, transactionId, and createdAt are locked.',
  },
  {
    id: 11,
    name: 'Cross-Customer Order Scraping',
    collection: 'orders',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    rationale: 'list requires resource.data.customerId == request.auth.uid || isAdmin().',
  },
  {
    id: 12,
    name: 'Unauthorized Site Payment Number Tampering',
    collection: 'siteSettings',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    rationale: 'Only isAdmin() can create or update siteSettings documents.',
  },
];
