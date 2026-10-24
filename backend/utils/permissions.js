/**
 * Permissions — who may do what.
 *
 * Every person has a ROLE (Admin, Owner or Supervisor) and the role gives a DEFAULT set of permissions. The Admin can then
 * switch individual features ON for a person (an "extra") or OFF (a "removal"). Both are stored on the user, as
 *     users.permissions = { "grant": ["records.view", …], "deny": ["payments.add", …] }
 * and the person's EFFECTIVE permissions are worked out here, in one place, on every request:
 *     effective = (role defaults + extras − removals), never anything Admin-only, never without its prerequisite.
 *
 * An Admin always has everything, whatever is stored.
 */

// key, label, group, what it allows, the permission it depends on, and whether only Admins may ever hold it
const CATALOG = [
  { key: 'entry.add',          group: 'Data Entry',    label: 'Add site entries',                 desc: 'Use the Data Entry tab to record each day’s vehicle and machine activity, with photos.' },
  { key: 'progress.add',       group: 'Data Entry',    label: 'Add site working progress images', desc: 'Attach pictures of the work in progress to an entry in the Data Entry tab. They cannot see the pictures afterwards.', requires: 'entry.add' },

  { key: 'records.view',       group: 'Records',       label: 'See Records',                      desc: 'Open the Records tab: every entry, with filters and photos.' },
  { key: 'records.export',     group: 'Records',       label: 'Export and print Records',         desc: 'Download Records as Excel, PDF or CSV, and print them.', requires: 'records.view' },
  { key: 'records.edit',       group: 'Records',       label: 'Edit entries',                     desc: 'Change an entry (a written reason is always needed).', requires: 'records.view' },
  { key: 'records.delete',     group: 'Records',       label: 'Delete entries',                   desc: 'Delete an entry (a written reason is always needed).', requires: 'records.view' },
  { key: 'progress.view',      group: 'Site Progress', label: 'See site working progress images',  desc: 'Open the Progress tab to see the pictures, and include them in reports.' },
  { key: 'progress.delete',    group: 'Site Progress', label: 'Delete site working progress images', desc: 'Remove a progress picture from view (a written reason is always needed).', requires: 'progress.view' },

  { key: 'renewals.view',      group: 'Renewals',      label: 'See renewals and get reminders',   desc: 'Open the Renewals tab (insurance, permits, subscriptions …), see its documents, and get the reminder bell.' },
  { key: 'renewals.add',       group: 'Renewals',      label: 'Add renewals and documents',       desc: 'Add a renewal, upload its documents, and mark it as renewed.', requires: 'renewals.view' },
  { key: 'renewals.edit',      group: 'Renewals',      label: 'Edit and delete renewals',         desc: 'Change a renewal, reopen one, or remove a renewal or a document (a written reason is always needed).', requires: 'renewals.view' },

  { key: 'purchases.add',      group: 'Purchases',     label: 'Add purchases',                    desc: 'Record material that arrives at a site, with weights and an attached slip. Sees the purchases they saved themselves.' },
  { key: 'purchases.view',     group: 'Purchases',     label: 'See all purchases',                desc: 'Open the full purchases list, with totals, filters and the attached files.' },
  { key: 'purchases.edit',     group: 'Purchases',     label: 'Edit and delete purchases',        desc: 'Change or remove a saved purchase (a written reason is always needed).', requires: 'purchases.view' },

  { key: 'summary.view',       group: 'Summary',       label: 'See the Summary',                  desc: 'Totals by day, week or any date range, with Excel and PDF export.' },

  { key: 'documents.view',     group: 'Documents',     label: 'See and download documents',       desc: 'Open the Documents tab, view and download stored files.' },
  { key: 'documents.print',    group: 'Documents',     label: 'Print documents',                  desc: 'Open a print view of a PDF, picture or text document.', requires: 'documents.view' },
  { key: 'documents.upload',   group: 'Documents',     label: 'Upload and edit documents',        desc: 'Add new documents and change their name, type, site or notes.', requires: 'documents.view' },
  { key: 'documents.delete',   group: 'Documents',     label: 'Delete documents',                 desc: 'Remove a stored document permanently.', requires: 'documents.view' },

  { key: 'payments.add',       group: 'Payments',      label: 'Add payments',                     desc: 'Enter Company and Outside Rental payment lines (name, item, payable, paid). Sees the lines they saved themselves.' },
  { key: 'payments.view',      group: 'Payments',      label: 'See all payments',                 desc: 'Open the full payment ledgers and the cumulative report, and export them.' },
  { key: 'payments.edit',      group: 'Payments',      label: 'Edit and delete payments',         desc: 'Change or remove a saved payment line (a written reason is always needed).', requires: 'payments.view' },

  { key: 'inventory.manage',   group: 'Inventory',     label: 'Manage Inventory',                 desc: 'Add, edit and switch off vehicles, sites and operators, and export them.' },

  { key: 'logs.view',          group: 'Activity Logs', label: 'See the Activity Log',             desc: 'Read who did what and when, and export the log.' },
  { key: 'logs.delete',        group: 'Activity Logs', label: 'Delete log entries',               desc: 'Remove entries from the Activity Log.', adminOnly: true },

  { key: 'archive.manage',     group: 'Archived',      label: 'Archived items',                   desc: 'See everything that was deleted, restore it, or delete it permanently (the file and the copy go for good).', adminOnly: true },
  { key: 'users.manage',       group: 'Users',         label: 'Manage Users',                     desc: 'Create, edit and switch off people and reset PINs.', adminOnly: true },
  { key: 'permissions.manage', group: 'Permissions',   label: 'Manage Permissions',               desc: 'Decide what each person can do (this tab).', adminOnly: true },
];

const KEYS = CATALOG.map(c => c.key);
const BY_KEY = Object.fromEntries(CATALOG.map(c => [c.key, c]));
const ADMIN_ONLY = new Set(CATALOG.filter(c => c.adminOnly).map(c => c.key));
const GROUPS = [...new Set(CATALOG.map(c => c.group))];

// What each role can do when nothing has been customised — exactly how the app behaved before permissions existed.
const ROLE_DEFAULTS = {
  admin: [...KEYS],
  owner: ['records.view', 'records.export', 'progress.view', 'renewals.view', 'renewals.add', 'purchases.view', 'summary.view', 'documents.view', 'documents.print', 'documents.upload', 'payments.view', 'logs.view'],
  supervisor: ['entry.add', 'progress.add', 'purchases.add', 'payments.add'],
};
const ROLES = Object.keys(ROLE_DEFAULTS);

const asList = v => (Array.isArray(v) ? v.filter(k => typeof k === 'string') : []);

/** Reads whatever is stored on the user into { grant: [], deny: [] } (tolerates null, text, junk). */
function readOverrides(stored) {
  let o = stored;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  if (!o || typeof o !== 'object') return { grant: [], deny: [] };
  return { grant: asList(o.grant).filter(k => BY_KEY[k]), deny: asList(o.deny).filter(k => BY_KEY[k]) };
}

/** A set of permissions with the rules applied: nothing unknown, nothing Admin-only (unless Admin), prerequisites present. */
function normalise(keys, role) {
  const set = new Set(asList(keys).filter(k => BY_KEY[k]));
  if (role !== 'admin') ADMIN_ONLY.forEach(k => set.delete(k));
  let changed = true;                               // a permission that depends on another one is dropped when that one is missing
  while (changed) {
    changed = false;
    for (const k of [...set]) {
      const req = BY_KEY[k].requires;
      if (req && !set.has(req)) { set.delete(k); changed = true; }
    }
  }
  return set;
}

/** The permissions a person actually has. */
function effectivePermissions(role, stored) {
  if (role === 'admin') return [...KEYS];
  const base = new Set(ROLE_DEFAULTS[role] || []);
  const { grant, deny } = readOverrides(stored);
  grant.forEach(k => base.add(k));
  deny.forEach(k => base.delete(k));
  return KEYS.filter(k => normalise([...base], role).has(k));          // catalogue order, rules applied
}

/** The smallest { grant, deny } that turns the role's defaults into the wanted set. */
function overridesFor(role, wanted) {
  const want = normalise(wanted, role);
  const base = new Set(ROLE_DEFAULTS[role] || []);
  return {
    grant: KEYS.filter(k => want.has(k) && !base.has(k)),
    deny: KEYS.filter(k => base.has(k) && !want.has(k)),
  };
}

/** Why a wanted set is not acceptable (or null). Used to give the Admin a clear message instead of silently fixing it. */
function problemWith(wanted, role) {
  if (!Array.isArray(wanted)) return 'The permissions must be a list.';
  const bad = wanted.find(k => typeof k !== 'string' || !BY_KEY[k]);
  if (bad !== undefined) return 'One of the permissions is not recognised.';
  if (role !== 'admin') {
    const locked = wanted.find(k => ADMIN_ONLY.has(k));
    if (locked) return `"${BY_KEY[locked].label}" can only be held by an Admin.`;
  }
  const set = new Set(wanted);
  for (const k of wanted) {
    const req = BY_KEY[k].requires;
    if (req && !set.has(req)) return `"${BY_KEY[k].label}" needs "${BY_KEY[req].label}" to be switched on as well.`;
  }
  return null;
}

const labelOf = k => (BY_KEY[k] ? `${BY_KEY[k].group} › ${BY_KEY[k].label}` : k);

module.exports = { CATALOG, KEYS, BY_KEY, ADMIN_ONLY, GROUPS, ROLE_DEFAULTS, ROLES, readOverrides, normalise, effectivePermissions, overridesFor, problemWith, labelOf };
