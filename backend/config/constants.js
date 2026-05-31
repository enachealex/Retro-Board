const VALID_DEPARTMENTS = ['QA', 'SE', 'SDET'];

// Default company name — override with DEFAULT_COMPANY env var
const DEFAULT_COMPANY = process.env.DEFAULT_COMPANY || 'RetroBoard';

const LEADS_BY_DEPT = {
    QA:  ['Nathan Robertson', 'Gabe Duncan', 'Brett Rogers', 'John Ezetta'],
    SE:  ['Dave Smith', 'Sean Montgomery'],
    SDET: ['Griffin Foster'],
};

const LEAD_DEFAULT_COLUMNS = [
    'Rules',
    'Ice Breaker',
    'Gripes',
    'Needs Improvement',
    'Went Well',
    'Wins/Shoutouts',
    'Action Items',
];

// Default admin emails with department mapping — loaded from env or fallback
// Env format: JSON array of [email, department] pairs
// e.g. DEFAULT_ADMIN_EMAILS='[["user@example.com","QA"],["other@example.com","SE"]]'
// No default department admins — app heads are masters only (see DEFAULT_MASTER_EMAILS).
const DEFAULT_ADMIN_EMAILS_RAW = process.env.DEFAULT_ADMIN_EMAILS
    ? JSON.parse(process.env.DEFAULT_ADMIN_EMAILS)
    : [];

// Flat list of admin emails (lowercase)
const DEFAULT_ADMIN_EMAILS = DEFAULT_ADMIN_EMAILS_RAW.map(e => (Array.isArray(e) ? e[0] : e).toLowerCase());

// Default master emails — loaded from env or fallback
// Env format: comma-separated emails e.g. DEFAULT_MASTER_EMAILS='a@x.com,b@x.com'
const DEFAULT_MASTER_EMAILS = process.env.DEFAULT_MASTER_EMAILS
    ? process.env.DEFAULT_MASTER_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : ['aenache@openeye.net', 'enachealex1@gmail.com'];

// Giphy API key for seeding default GIF library
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';

module.exports = {
    DEFAULT_COMPANY,
    VALID_DEPARTMENTS,
    LEADS_BY_DEPT,
    LEAD_DEFAULT_COLUMNS,
    DEFAULT_ADMIN_EMAILS,
    DEFAULT_ADMIN_EMAILS_RAW,
    DEFAULT_MASTER_EMAILS,
    GIPHY_API_KEY,
};
