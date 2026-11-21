/* ═══════════════════════════════════════════════════════════════════════════════
   Learn Guide — how to use every screen, with worked examples (all names and numbers are made up).
   Opened from the menu under the user's name (top right). A person sees only the parts for the screens they may use.
   To change the guide, edit GUIDE below: each section has blocks of type p / steps / list / example / tip / note.
   ═══════════════════════════════════════════════════════════════════════════════ */
const GUIDE = [
  { id: 'start', title: 'Getting started', perms: null, blocks: [
    { t: 'p', v: 'Sri Charan Constructions is where the site log, purchases, payments, documents and renewals are kept in one place. This guide shows how to use each screen, how to save, and how to fix a mistake.' },
    { t: 'steps', title: 'Signing in and moving around', v: [
      'Open the website or the Android app and type your <b>PIN</b>. The PIN is given to you by the Admin.',
      'Your name and role show at the top right. Click on it to open the menu: <b>Learn Guide</b>, <b>Feedback</b> and <b>Change PIN</b>.',
      'The screens you may use are listed down the left side (on a phone, use the menu button). You see only the screens that are switched on for you.',
      'To leave, press <b>Logout</b> and confirm.'] },
    { t: 'list', title: 'Things that work the same everywhere', v: [
      'A star <b>*</b> next to a name means it must be filled in.',
      'Before something important is saved, the app asks <b>"Are you sure?"</b>. Press <b>No</b> and nothing is saved; what you typed stays on the screen.',
      'To <b>edit or delete</b> something that is already saved, the app asks for a <b>reason</b>. The reason is saved in the Activity Log with your name and the time.',
      'Nothing deleted is lost at once: it goes to <b>Archived</b> and the Admin can restore it.',
      '<b>Export</b> buttons give an Excel (.xlsx) or PDF file of what is on the screen. Total lines are in bold.',
      'Dates are shown as <b>day-month-year</b>, amounts in rupees.'] },
    { t: 'tip', v: 'If a screen looks old after an update, press <b>Ctrl + F5</b> on a computer, or close and reopen the app on a phone.' },
  ] },
  { id: 'account', title: 'Your menu: PIN, Feedback, Guide', perms: null, blocks: [
    { t: 'steps', title: 'Change your own PIN', v: [
      'Click your name at the top right and choose <b>Change PIN</b>.',
      'Type the <b>new PIN</b> twice. You do not need to type the old one.',
      'A PIN has 4 to 10 characters, no spaces, and nobody else may use the same one.',
      'Press <b>Change PIN</b>. Use the new PIN the next time you sign in.'] },
    { t: 'steps', title: 'Send feedback', v: [
      'Click your name and choose <b>Feedback</b>.',
      'Tap the <b>stars</b> (1 to 5) to rate the app. This is optional.',
      'Choose <b>Suggestion</b>, <b>Problem</b> or <b>Question</b> and write what you want to say.',
      'Press <b>Send</b>. The Admin reads it. Please do not write PINs or passwords in it.'] },
    { t: 'note', v: 'Forgot your PIN? Ask the Admin. The Admin opens <b>Users</b>, edits your name, types a new PIN and saves.' },
  ] },
  { id: 'home', title: 'Home', perms: null, tab: 'home', blocks: [
    { t: 'p', v: 'Home is the first screen after sign-in: a quick look at today.' },
    { t: 'list', title: 'What you see', v: [
      '<b>From / To</b> dates with <b>Today</b> and <b>This month</b> buttons. They change the numbers below.',
      'Cards for <b>Records today</b> (hours, diesel, loads), <b>Renewals that need attention</b>, <b>Balance to pay</b> (payable, paid, company, outside rental) and <b>Items in the Archive</b>.',
      '<b>Site-wise activity</b>: records, hours, diesel and loads for each site in the chosen dates.',
      '<b>Quick actions</b>: shortcuts such as Add a record, Add a purchase, Add payment lines, Add a renewal, Upload a document.',
      '<b>Download full backup (Excel)</b> for the people who are allowed: one Excel file with all the data.'] },
  ] },
  { id: 'entry', title: 'Data Entry', perms: ['entry.add'], tab: 'entry', blocks: [
    { t: 'p', v: 'Use Data Entry every day to record what each vehicle or machine did on a site: readings, working hours, diesel and loads.' },
    { t: 'steps', title: 'Saving one vehicle', v: [
      'Choose the <b>Date</b> and the <b>Site</b>.',
      'Choose <b>Category</b>: <b>Own</b> (pick the vehicle from the list) or <b>Rental</b> (type the vehicle or machine number and the driver name).',
      'Type the <b>Starting Reading</b> and the <b>Closing Reading</b>. <b>Working Hours</b> fills by itself.',
      'Type the <b>Diesel (Litres)</b> given and the number of <b>Loads</b>. Choose the <b>Operator / Driver</b> and add <b>Remarks</b> if needed.',
      'Press <b>Add photo proof</b> under a reading or the diesel to take or choose a photo. It uploads in a moment; wait for it before saving.',
      'Press <b>Save Entry</b> and confirm.'] },
    { t: 'steps', title: 'Saving many vehicles in one go (+ Add Entry)', v: [
      'Fill the first vehicle as above, but press <b>+ Add Entry</b> instead of Save. It moves into the list <b>Entries ready to save</b>.',
      'Date, Site and Category stay. Only the vehicle details clear. Fill the next vehicle and press <b>+ Add Entry</b> again.',
      'Wrong one? Press <b>Remove</b> beside it in the list.',
      'When all are in, press <b>Save</b> once (it says <b>Save 3 Entries</b>). Confirm. Everything is saved together.'] },
    { t: 'example', title: 'Example: three tippers at Sunlarge on 18-11-2026', head: ['Vehicle', 'Start', 'Close', 'Diesel', 'Loads'], rows: [['TN01 A 1111', '100', '108', '25 L', '4'], ['TN01 B 2222', '210', '216', '18 L', '3'], ['TN01 C 3333', '55', '61', '20 L', '3']], note: 'Fill the first row and press + Add Entry. Do the same for the second. For the third, you may press Save Entry directly: it saves all three.' },
    { t: 'steps', title: 'Loads breakup for the day (card below the form)', v: [
      'The loads of the whole day at a site are split by unloading point. Choose the <b>Date</b> and <b>Site</b> in that card.',
      'Press <b>+ Add line</b>, type the unloading point and the loads. The lines must add up to the loads of the day.',
      'Press <b>Save breakup</b>. To remove it, press <b>Clear breakup</b> (a reason is asked).'] },
    { t: 'list', title: 'Site Working Progress Images (optional)', v: ['Press <b>Add progress photos</b> to attach pictures of the work. Only the Owner and Admin can see them afterwards, in the <b>Progress</b> screen.'] },
    { t: 'note', title: 'Diesel stock', v: 'Diesel is taken from the stock of the site. If no stock has been added for the site, a pop-up asks you to add <b>Diesel Stock Received</b> first. Your entry is kept and saved as soon as the stock is added. If you are not allowed to add stock, ask the Admin or Owner.' },
  ] },
  { id: 'records', title: 'Records', perms: ['records.view'], tab: 'records', blocks: [
    { t: 'p', v: 'Records lists every entry saved in Data Entry, with photos and totals.' },
    { t: 'steps', title: 'Finding records', v: [
      'Use <b>Order</b> (Oldest first / Newest first), <b>From date</b>, <b>To date</b>, <b>Category</b>, <b>Type</b>, <b>Vehicle / Machine No.</b> and <b>Site</b>.',
      '<b>Type, Vehicle and Site</b> are tick-box lists: tick as many as you want.',
      'Press <b>Clear filters</b> to start again.'] },
    { t: 'steps', title: 'Downloading a report', v: [
      'Press <b>Export</b>. A box asks what you want, with tick boxes: <b>Only Records</b>, <b>Only Site Working Progress Images</b>, <b>Only Loads Breakup</b> or <b>All</b>. Tick one or more and press <b>Next</b>.',
      'Choose <b>Excel</b>, <b>PDF</b> or <b>CSV</b>. CSV is text only: pictures are marked Yes / No.',
      '<b>Print</b> prints what is on the screen.'] },
    { t: 'steps', title: 'Correcting or deleting a record (people with permission)', v: [
      'Press the edit or delete button on the record.',
      'Change what is wrong and press <b>Save Changes</b>. Type the <b>reason</b> (at least 10 characters) and press <b>Confirm &amp; Save</b>.',
      'A deleted record goes to <b>Archived</b>.'] },
    { t: 'tip', v: 'The reason is read later in the Activity Log, so write it clearly. Example: "Closing reading typed 1380 instead of 1308".' },
  ] },
  { id: 'progress', title: 'Progress pictures', perms: ['progress.view'], tab: 'progress', blocks: [
    { t: 'p', v: 'All site working pictures, shown by day and site. Pictures are added in Data Entry.' },
    { t: 'list', v: ['Choose <b>From date</b>, <b>To date</b> and <b>Site</b>.', 'Press <b>Show more pictures</b> to see older ones.', 'Click a picture to see it big. If you are allowed, you can delete a wrong picture.'] },
  ] },
  { id: 'purchases', title: 'Purchases', perms: ['purchases.add', 'purchases.view'], tab: 'purchases', blocks: [
    { t: 'p', v: 'Record material that arrives on site, with its weighbridge weights.' },
    { t: 'steps', title: 'Saving a purchase', v: [
      'Choose <b>Date</b> and <b>Site</b>. Type the <b>Supplier</b>, <b>Vehicle No.</b> and <b>Item name</b>.',
      'Type the <b>Load weight (kg)</b> and the <b>Empty weight (kg)</b>. The <b>Net weight</b> is worked out for you (load minus empty).',
      'Attach the weighbridge slip or invoice if you have it (optional).',
      'Press <b>Save purchase</b>.'] },
    { t: 'example', title: 'Example', head: ['Item', 'Supplier', 'Load', 'Empty', 'Net'], rows: [['Sand', 'Ravi Traders', '31,500 kg', '11,200 kg', '20,300 kg']], note: 'You type the load and empty weights. The net weight appears by itself.' },
  ] },
  { id: 'summary', title: 'Summary and Diesel Expenses', perms: ['summary.view'], tab: 'summary', blocks: [
    { t: 'p', v: 'Summary has two parts, chosen at the top: <b>Auto Summary</b> and <b>Diesel Expenses</b>.' },
    { t: 'steps', title: 'Auto Summary', v: ['Choose <b>From</b> and <b>To</b> dates and, if you want, vehicle type, vehicle and site (tick boxes: choose several).', 'The totals of hours, diesel and loads are worked out from Records.', 'Press <b>Export</b> for Excel or PDF. Tip: the report shows a Per Vehicle Break Up.'] },
    { t: 'steps', title: 'Diesel Expenses', v: [
      '<b>Stock &amp; Balance</b>: for each site, diesel received minus diesel used gives the balance. Press <b>Add stock</b>, choose the <b>Date</b> and <b>Site</b>, type <b>Diesel Stock Received (L)</b> and a note, and save.',
      '<b>Fills with proof</b>: every diesel fill that has a proof photo. Filter by dates and site, and press <b>Export</b> to get a report with the photos.'] },
    { t: 'example', title: 'Example: diesel at Sunlarge', head: ['Date', 'Received', 'Used', 'Balance'], rows: [['01-11-2026', '500 L', '', '500 L'], ['05-11-2026', '', '63 L', '437 L'], ['10-11-2026', '300 L', '', '737 L']], note: 'When usage in Data Entry is more than the stock, the balance goes below zero and the app warns you.' },
  ] },
  { id: 'documents', title: 'Documents', perms: ['documents.view'], tab: 'documents', blocks: [
    { t: 'p', v: 'Keep important files (agreements, bills, licences, drawings) in one place.' },
    { t: 'steps', title: 'Uploading a document (people allowed to upload)', v: ['Type the <b>Document name</b>, choose the <b>Type of document</b>, and a <b>Site</b> if it belongs to one. Notes are optional.', 'Choose the <b>File</b> and press <b>Upload document</b>.'] },
    { t: 'list', title: 'Using documents', v: ['Search and filter the list, then <b>view</b>, <b>download</b> or <b>print</b> a document (each is switched on separately by the Admin).', 'Each view, download and print is written to the Activity Log.'] },
  ] },
  { id: 'renewals', title: 'Renewals', perms: ['renewals.view'], tab: 'renewals', blocks: [
    { t: 'p', v: 'Never miss insurance, permit, fitness or any other renewal. The app reminds you before the date.' },
    { t: 'steps', title: 'Adding a renewal', v: ['Choose the <b>Type of renewal</b>, the <b>Renewal date</b> (the date it ends or must be renewed), the <b>Amount</b> and <b>Who paid</b>. Add a description.', 'Press <b>Choose documents</b> to attach the policy or receipt.', 'Press <b>Save renewal</b>.'] },
    { t: 'steps', title: 'Vehicle documents: Insurance, Permit, Tax, FC and PUCC for every vehicle', v: [
      'In <b>Renewals</b> press the <b>Vehicle documents</b> tab. Every vehicle from Inventory is a row, with its <b>Sl No</b>, <b>Vehicle No</b>, <b>Insurance</b>, <b>Permit</b>, <b>Tax</b>, <b>FC (Fitness Certificate)</b>, <b>PUCC</b> and <b>Registration date</b>.',
      'Each date is the day the document <b>expires</b>. Press <b>+ Add date</b> in a box, choose the date and press <b>Save date</b>.',
      'The colour tells you the state: <b>Overdue</b> (red), <b>Due today</b> and <b>Due soon</b> (orange), <b>Valid</b> (green). The cards on top count them.',
      'When a document is renewed, press its date and choose the <b>new, later</b> expiry date. The app marks the old one as renewed and starts reminding for the new one. These dates also ring the bell like any other renewal.',
      'A date typed too early by mistake can be corrected by someone who may edit renewals: choose the right date and give a reason.',
      'Use <b>Vehicle</b> to search, <b>Show</b> to see only <b>Needs attention</b> or <b>Dates not entered</b>, and <b>Export</b> for Excel or PDF.'] },
    { t: 'example', title: 'Example: three vehicles on 21-11-2026', head: ['Sl No', 'Vehicle No', 'Insurance', 'Permit', 'Tax', 'FC', 'PUCC', 'Registration'], rows: [['1', 'TN01 A 1111', '15-03-2027', '30-06-2027', '31-12-2026', '10-02-2027', '18-11-2026 (overdue)', '12-05-2021'], ['2', 'TN01 B 2222', '02-12-2026 (due soon)', '30-06-2027', '31-12-2026', '25-01-2027', '14-04-2027', '03-08-2022'], ['3', 'TN01 C 3333', '', '', '', '', '', '20-09-2023']], note: 'Vehicle 1: the PUCC expired three days ago, so it is red and the bell reminds you. Vehicle 3 has no dates yet: press + Add date in each box.' },
    { t: 'list', title: 'Reading the list and the bell', v: ['<b>All renewals</b> can be searched and filtered: Show <b>Not yet renewed</b>, <b>Renewed</b> or <b>Everything</b>, Type, From and To dates.', 'The <b>bell</b> at the top shows reminders: <b>Overdue</b>, <b>Due today</b>, <b>Due soon</b> and <b>Upcoming</b>. Press <b>Mark all read</b> to clear it.', 'When a renewal is done, mark it as renewed; add the next one with the new date.'] },
  ] },
  { id: 'payments', title: 'Payments', perms: ['payments.add', 'payments.view'], tab: 'payments', blocks: [
    { t: 'p', v: 'Payments has four parts, chosen at the top: <b>Company Payments</b>, <b>Outside Rental Payments</b>, <b>Cumulative Report</b> and <b>Party Ledger (Dr / Cr)</b>.' },
    { t: 'steps', title: 'Company or Outside Rental payments: add lines', v: [
      'In <b>Add company payments</b> each row is one line: <b>Date</b>, <b>Site</b>, <b>Name</b> (who we pay), <b>Item</b>, <b>Description</b>, <b>Payable</b> (what we owe), <b>Paid</b> (what we paid now) and <b>Paid By</b>. <b>Balance</b> is worked out (payable minus paid).',
      'Press <b>+ Add line</b> for as many rows as you need. Press <b>Save payments</b> once: all rows are saved together, or none.',
      'The saved lines are in the ledger below, with filters and <b>Export</b>. Edit or delete asks for a reason.'] },
    { t: 'example', title: 'Example: three lines saved together', head: ['Date', 'Name', 'Item', 'Payable', 'Paid', 'Balance'], rows: [['05-11-2026', 'Lakshmi Cement Agency', 'Cement 200 bags', '72,000', '50,000', '22,000'], ['06-11-2026', 'Ravi Steel Traders', 'Steel', '38,500', '38,500', '0'], ['08-11-2026', 'Venkat JCB Rental', 'JCB hire', '25,000', '10,000', '15,000']], note: 'Fill three rows with + Add line, then press Save payments once. Total payable 1,35,500, paid 98,500, balance 37,000.' },
    { t: 'p', title: 'Cumulative Report', v: 'Shows each name with total payable, total paid and balance, for company and outside rental together. Use the filters and <b>Export</b>.' },
    { t: 'steps', title: 'Party Ledger (Dr / Cr): the Tally way', v: [
      '<b>Cr</b> = a bill or amount payable to the party (we owe more). <b>Dr</b> = a payment made to the party (we owe less). The balance shows <b>Cr</b> while we still owe and <b>Dr</b> if we paid in advance.',
      'Choose <b>One party</b> and pick the party, or <b>All parties</b> to see everyone with Opening, Dr, Cr and Closing balance. <b>From</b> and <b>To</b> start from the financial year (1 April) and can be changed. Everything before the From date is carried forward as the <b>Opening Balance</b>.',
      'Press <b>+ Add entry</b>. For each line choose what you are recording: <b>Bill / Payable (Cr)</b>, <b>Payment made (Dr)</b>, or an <b>Opening Balance</b> (Cr if we owed the party before using the app, Dr if we had paid in advance). Press <b>+ Add Entry</b> for more lines and <b>Save entries</b> once.',
      'Press <b>Export</b> for Excel or PDF of the one party or of all parties.'] },
    { t: 'example', title: 'Example: Lakshmi Cement Agency, 1 October to 17 November', head: ['Date', 'Particulars', 'Dr (Paid)', 'Cr (Payable)', 'Balance'], rows: [['01-10-2026', 'Opening Balance', '', '45,000', '45,000 Cr'], ['05-10-2026', 'Cement 200 bags (bill)', '', '72,000', '1,17,000 Cr'], ['12-10-2026', 'Paid in cash', '50,000', '', '67,000 Cr'], ['21-10-2026', 'Steel (bill)', '', '38,500', '1,05,500 Cr'], ['28-10-2026', 'Paid by UPI', '60,000', '', '45,500 Cr'], ['09-11-2026', 'Cement 100 bags (bill)', '', '36,000', '81,500 Cr'], ['15-11-2026', 'Paid by bank', '40,000', '', '41,500 Cr'], ['17-11-2026', 'Closing Balance', '', '', '41,500 Cr']], note: 'Each Cr adds to what we owe and each Dr takes it away. Check: 45,000 + 1,46,500 (bills) &minus; 1,50,000 (paid) = 41,500 Cr still to pay. Both columns total 1,91,500, as in Tally.' },
    { t: 'example', title: 'Example: how to enter a purchase that is partly paid', head: ['Line', 'Type', 'Party', 'Item', 'Amount'], rows: [['1', 'Bill / Payable (Cr)', 'Ravi Steel Traders', 'Steel', '10,000'], ['2', 'Payment made (Dr)', 'Ravi Steel Traders', 'Payment', '4,000']], note: 'Two lines in one Save. The ledger then shows 6,000 Cr: still to pay.' },
    { t: 'note', v: 'Lines saved in Company Payments or Outside Rental Payments appear in the ledger by themselves (their Payable is a Cr and their Paid is a Dr). Do not enter them again.' },
  ] },
  { id: 'inventory', title: 'Inventory', perms: ['inventory.manage'], tab: 'inventory', blocks: [
    { t: 'p', v: 'Inventory holds the lists that appear as drop-downs everywhere else: vehicles, sites and operators. Keep them correct and the rest of the app stays tidy.' },
    { t: 'steps', title: 'Adding to a list', v: ['Choose the tab: <b>Vehicles / Machines</b>, <b>Sites</b> or <b>Operators / Drivers</b>.', 'Press <b>＋ Add</b> (Vehicle, Site or Operator), fill the form: vehicle number and type; site name and location; operator name and phone.', 'Save. It appears in the drop-downs at once.'] },
    { t: 'list', v: ['Use the <b>Type</b> of a vehicle (Tipper, JCB, and so on) to filter Records and Summary.', 'To stop using something, switch it off instead of deleting it. Old records keep their names.', '<b>Export</b> gives the whole list in Excel or PDF.'] },
  ] },
  { id: 'users', title: 'Users', perms: ['users.manage'], tab: 'users', blocks: [
    { t: 'steps', title: 'Creating a user', v: ['Press <b>＋ Create User</b>.', 'Type the <b>Name</b>, a <b>PIN</b> (4 to 10 characters, no spaces, not used by anyone else) and choose the <b>Role</b>: <b>Supervisor</b>, <b>Owner</b> or <b>Admin</b>.', 'Press save and tell the person their PIN privately.'] },
    { t: 'list', title: 'Roles at a glance', v: ['<b>Supervisor</b>: usually Data Entry, progress photos, purchases and payment lines.', '<b>Owner</b>: usually views records, summary, documents, payments, renewals and logs.', '<b>Admin</b>: everything, including users and permissions.', 'The Admin can switch single abilities on or off for a person in <b>Permissions</b>.'] },
    { t: 'steps', title: 'Editing or removing', v: ['Edit a user to change the name, role, status (active or not) or give a <b>New PIN</b> (leave it empty to keep the old one).', 'To delete, type <b>DELETE</b> to confirm. A deleted user cannot sign in. <b>Export</b> includes deleted users.'] },
  ] },
  { id: 'permissions', title: 'Permissions and reminders', perms: ['permissions.manage'], tab: 'permissions', blocks: [
    { t: 'p', v: 'Decide, person by person, which screens and actions are switched on. A person with nothing switched on sees "Nothing is switched on for you yet".' },
    { t: 'list', v: ['Choose the person, then tick or untick what they may do (view, add, edit, delete, export, upload and so on).', 'Changes work the next time the person opens a screen.', 'Here you also set the <b>renewal reminders</b>: <b>Reminders are on</b>, <b>Start reminding</b> (how many days before) and <b>Repeat every</b>. Press <b>Save reminder settings</b>, or <b>Use the standard settings</b>.'] },
    { t: 'tip', v: 'Give each person only what they need. A supervisor who enters data does not need to delete records.' },
  ] },
  { id: 'archive', title: 'Archived', perms: ['archive.manage'], tab: 'archive', blocks: [
    { t: 'p', v: 'Everything that is deleted from Records, Payments, Purchases and other screens is kept here, with who deleted it, when and why.' },
    { t: 'steps', title: 'Using the archive', v: ['Use <b>Search</b>, <b>Kind</b> and the <b>Deleted from / to</b> dates to find an item.', 'Press <b>Restore</b> to bring it back.', 'To remove for ever, tick the items (or <b>Select all shown</b>) and press <b>Delete selected permanently</b>. This cannot be undone.'] },
  ] },
  { id: 'logs', title: 'Activity Logs', perms: ['logs.view'], tab: 'logs', blocks: [
    { t: 'p', v: 'A record of who did what and when: sign-ins, entries added or changed, deleted items, exports, PIN changes and more. Changes show the old and new value and the reason given.' },
    { t: 'list', v: ['Filter by date, person, area or action; press <b>Refresh</b> for the latest and <b>Load more</b> for older lines.', 'Press <b>Export</b> for an Excel or PDF of what matches.', 'People with the right can tick lines and press <b>Delete selected</b> (clear old lines).'] },
  ] },
  { id: 'help', title: 'Questions and answers', perms: null, blocks: [
    { t: 'list', v: [
      '<b>My entry did not save.</b> Read the red message. Common reasons: a required field (*) is empty, a photo is still uploading, or the site has no diesel stock.',
      '<b>I saved something wrong.</b> Records and payments can be edited with a reason by people who have permission. If you cannot edit, tell the Admin.',
      '<b>I deleted something by mistake.</b> Ask the Admin to restore it from <b>Archived</b>.',
      '<b>A vehicle, site or operator is missing in the list.</b> The Admin adds it in <b>Inventory</b>.',
      '<b>I cannot see a screen.</b> It is not switched on for you. Ask the Admin (Permissions).',
      '<b>The app on my phone shows the old screen.</b> Close it completely and open it again.'] },
    { t: 'note', v: 'Still stuck? Send a <b>Feedback</b> from the menu under your name, with what you were doing and what the screen said.' },
  ] },
];

/* ── download the guide as PDF or Word (all the sections the person may use, in order) ── */
function guideFullHtml() {
  return guideVisible().map(s => `<section class="gdx-sec"><h2>${gEsc(s.title)}</h2>${s.blocks.map(guideBlock).join('')}</section>`).join('');
}
function guideWho() { const u = Auth.currentUser(); return u ? `${u.name || ''}${u.role ? ' (' + u.role + ')' : ''}` : ''; }
function guideDownloadWord() {
  const css = 'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}h1{font-size:22pt}h2{font-size:16pt;margin-top:22pt;border-bottom:1px solid #999}h4,.gd-h4{font-size:12pt;margin:12pt 0 4pt}table{border-collapse:collapse;width:100%;margin:6pt 0}th,td{border:1px solid #999;padding:4pt 6pt;text-align:left;font-size:10pt}th{background:#eee}.gd-ex-title{font-weight:bold;margin-top:10pt}.gd-box{border:1px solid #ccc;padding:6pt;margin:8pt 0}';
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Learn Guide</title><style>${css}</style></head><body><h1>Sri Charan Constructions &mdash; Learn Guide</h1><p>Prepared for ${gEsc(guideWho())} on ${gEsc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }))}</p>${guideFullHtml()}</body></html>`;
  const url = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
  const a = document.createElement('a'); a.href = url; a.download = 'Sri-Charan-Learn-Guide.doc'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (typeof showToast === 'function') showToast('The guide is downloading as a Word file.');
}
function guideDownloadPdf() {
  let box = document.getElementById('gd-print'); if (box) box.remove();
  box = document.createElement('div'); box.id = 'gd-print';
  box.innerHTML = `<h1>Sri Charan Constructions &mdash; Learn Guide</h1><p class="gdx-who">Prepared for ${gEsc(guideWho())} on ${gEsc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }))}</p>${guideFullHtml()}`;
  document.body.appendChild(box); document.body.classList.add('gd-printing');
  const done = () => { document.body.classList.remove('gd-printing'); box.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  if (typeof showToast === 'function') showToast('In the print box, choose "Save as PDF" as the printer.');
  setTimeout(() => window.print(), 400);
}

/* ── the viewer ─────────────────────────────────────────────────────────────── */
const GUIDE_UI = { current: 'start', q: '' };
const gEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const guideVisible = () => GUIDE.filter(s => !s.perms || s.perms.some(can));
const guideText = s => (s.title + ' ' + s.blocks.map(b => [b.title, b.v && (Array.isArray(b.v) ? b.v.join(' ') : b.v), b.note, b.head && b.head.join(' '), b.rows && b.rows.flat().join(' ')].filter(Boolean).join(' ')).join(' ')).replace(/<[^>]+>/g, ' ').toLowerCase();

function guideBlock(b) {
  const title = b.title ? `<h4 class="gd-h4">${gEsc(b.title)}</h4>` : '';
  if (b.t === 'p') return `${title}<p>${b.v}</p>`;
  if (b.t === 'steps') return `${title}<ol class="gd-steps">${b.v.map(x => `<li>${x}</li>`).join('')}</ol>`;
  if (b.t === 'list') return `${title}<ul class="gd-list">${b.v.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (b.t === 'tip') return `<div class="gd-box gd-tip"><b>Tip</b><span>${b.v}</span></div>`;
  if (b.t === 'note') return `<div class="gd-box gd-note"><b>${gEsc(b.title || 'Note')}</b><span>${b.v}</span></div>`;
  if (b.t === 'example') return `<div class="gd-example"><div class="gd-ex-title">${gEsc(b.title)}</div><div class="table-wrap"><table class="gd-table"><thead><tr>${b.head.map(h => `<th>${gEsc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, i) => `<td data-label="${gEsc(b.head[i])}">${gEsc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${b.note ? `<p class="gd-ex-note">${b.note}</p>` : ''}</div>`;
  return '';
}

function renderGuide() {
  const vis = guideVisible(), q = GUIDE_UI.q.trim().toLowerCase();
  const shown = q ? vis.filter(s => guideText(s).includes(q)) : vis;
  if (!vis.some(s => s.id === GUIDE_UI.current)) GUIDE_UI.current = vis[0] ? vis[0].id : '';
  const nav = document.getElementById('gd-nav'), body = document.getElementById('gd-body'), sel = document.getElementById('gd-select');
  nav.innerHTML = shown.length ? shown.map(s => `<button type="button" class="gd-nav-btn${s.id === GUIDE_UI.current ? ' active' : ''}" data-gd="${s.id}">${gEsc(s.title)}</button>`).join('') : '<p class="gd-none">Nothing matches your search.</p>';
  sel.innerHTML = shown.map(s => `<option value="${s.id}"${s.id === GUIDE_UI.current ? ' selected' : ''}>${gEsc(s.title)}</option>`).join('');
  const s = vis.find(x => x.id === GUIDE_UI.current); if (!s) { body.innerHTML = ''; return; }
  const i = vis.indexOf(s), prev = vis[i - 1], next = vis[i + 1];
  body.innerHTML = `<h3 class="gd-title">${gEsc(s.title)}</h3>${s.blocks.map(guideBlock).join('')}
    <div class="gd-pager">${prev ? `<button type="button" class="btn btn-outline" data-gd="${prev.id}">&lsaquo; ${gEsc(prev.title)}</button>` : '<span></span>'}${next ? `<button type="button" class="btn btn-outline" data-gd="${next.id}">${gEsc(next.title)} &rsaquo;</button>` : ''}</div>`;
  body.scrollTop = 0; const sc = document.getElementById('gd-main'); if (sc) sc.scrollTop = 0;
}

function openGuide(sectionId) {
  const overlay = document.getElementById('guide-overlay'); if (!overlay) return;
  const vis = guideVisible();
  if (sectionId && vis.some(s => s.id === sectionId)) GUIDE_UI.current = sectionId;
  GUIDE_UI.q = ''; document.getElementById('gd-search').value = '';
  renderGuide(); overlay.classList.add('open');
  document.body.classList.add('gd-open');
  setTimeout(() => { const c = document.getElementById('gd-close'); if (c) c.focus(); }, 50);
}
function closeGuide() { document.getElementById('guide-overlay').classList.remove('open'); document.body.classList.remove('gd-open'); }
/** The guide section for the screen the person is on now (so "Learn Guide" opens where they are). */
function guideSectionForCurrentTab() {
  const el = document.querySelector('.tab.active'); const name = el && el.id ? el.id.replace(/^tab-/, '') : '';
  const s = GUIDE.find(x => x.tab === name); return s ? s.id : null;
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('guide-overlay'); if (!overlay) return;
  overlay.addEventListener('click', ev => {
    if (ev.target === overlay || ev.target.closest('#gd-close')) { closeGuide(); return; }
    const b = ev.target.closest('[data-gd]'); if (b) { GUIDE_UI.current = b.dataset.gd; renderGuide(); }
  });
  document.getElementById('gd-pdf').addEventListener('click', guideDownloadPdf);
  document.getElementById('gd-word').addEventListener('click', guideDownloadWord);
  document.getElementById('gd-select').addEventListener('change', ev => { GUIDE_UI.current = ev.target.value; renderGuide(); });
  document.getElementById('gd-search').addEventListener('input', ev => { GUIDE_UI.q = ev.target.value; renderGuide(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && overlay.classList.contains('open')) closeGuide(); });
});
