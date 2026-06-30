# TabJournal — Privacy Policy

**Short version: everything stays on your device. TabJournal has no servers, no
accounts, and makes no network requests. We literally cannot see your data.**

This is the honest, complete description of what TabJournal does with your data.
The source code is small and open — you can verify every claim below yourself.

## What it records

While journaling is active, TabJournal periodically (and when tabs change) saves
a snapshot of your open tabs:

- the page **title**
- the page **address (URL)** — by default with the query string and fragment
  **removed**, so secrets like session tokens or password-reset links are not kept
- the tab's position and pinned state
- a **timestamp**

It records **only** `http://` and `https://` pages. It never records
browser-internal pages, extension pages, `file://` pages, or anything from a
domain you add to the exclude list.

## Where it goes

Into your browser's **local storage, on this device only**
(`storage.local`). That's it. Specifically, TabJournal does **not**:

- send anything to any server (there is no backend, and no `fetch`/network code)
- use any analytics, telemetry, or tracking
- require an account or login
- sync your journal anywhere
- request access to page **content** — it has no host permissions and cannot
  read what's on the pages you visit, only the tab's title and address

## What you control

- **Pause** all recording instantly from the toolbar popup.
- **Exclude domains** you never want journaled (subdomains included).
- **Store full URLs** only if you explicitly opt in (off by default).
- **Export** your entire journal as a JSON file whenever you like.
- **Delete everything** permanently with one click, from the popup or options page.

## Permissions and why each is needed

| Permission | Why |
|---|---|
| `tabs` | to read the title and URL of your open tabs (the core feature) |
| `storage` | to save the journal locally on your device |
| `alarms` | to take a snapshot on a periodic timer |

TabJournal deliberately does **not** request host permissions
(`<all_urls>`), so it cannot read or modify page contents.

## Contact

TabJournal is a local, open-source tool. Since no data ever leaves your machine,
there is nothing for us to access, sell, or leak — by design.
