# LinkTrail — Privacy Policy

**Short version: everything stays on your device. LinkTrail has no servers, no
accounts, and makes no network requests. We cannot see your data.**

This is a complete, plain description of what LinkTrail does with your data,
including its limits. The source is small and open, so you can check every
claim below yourself.

## What it records

While recording is on, LinkTrail keeps **one record per link** you've had open:

- the page **address (URL)**. By default the query string and fragment (the
  parts after `?` and `#`) are **removed**, and any embedded username/password
  is always removed.
- the page **title**, unless you turn titles off
- **when you first and last saw** that link

It checks your open tabs every few minutes and shortly after a tab navigates.

### What it never records

- **Private / incognito windows.** The extension is declared
  `"incognito": "not_allowed"`, so the browser never runs it there. As a second
  safeguard, the code also skips any tab marked private.
- Browser-internal pages, extension pages, and `file://` pages. Only
  `http://` and `https://` pages are recorded.
- Any site on your **"Never record these sites"** list, including its subdomains.

### What it can still reveal, honestly

Removing query strings protects most secrets, but not all of them:

- **Titles can be personal.** An inbox title often shows your email address,
  and a document title can show its name. Turn off **Store page titles** if
  that matters to you. Titles already saved are then erased.
- **Some sites put secrets in the path itself**, such as reset tokens, magic
  sign-in links, or "anyone with the link" document addresses. Add those sites
  to the exclude list.
- The saved data is **not encrypted**. It sits in your browser profile like
  your normal history. Anyone with access to your computer account could read
  it, just as they could read your browser history.

## Where it goes

Into your browser's **local storage on this device** (`storage.local`), and
nowhere else. LinkTrail does **not**:

- send anything to any server (there is no backend and no network code)
- use analytics, telemetry, or tracking
- require an account or sync your data
- read page **content**. It has no host permissions, so it sees only each
  tab's address and title, never what's on the page.

## What you control

- **Pause** recording instantly with the "Recording" toggle in the popup.
- **Exclude sites.** Paste a domain or any address from the site. Links already
  saved from those sites are **deleted**, not just hidden.
- **Full addresses** are opt-in. Turning them back off strips query strings
  from links already saved.
- **Titles** can be switched off. Doing so erases titles already saved.
- **Export** everything as JSON whenever you like.
- **Delete everything** permanently from the popup or settings. The delete runs
  in the same queue as every save, so a save that's already in progress cannot
  bring deleted data back.

## Retention

LinkTrail keeps up to 5,000 links by default (adjustable). When it's full, the
links you saw longest ago are removed first. Nothing is kept anywhere else.

## Permissions and why each is needed

| Permission | Why |
|---|---|
| `tabs` | to read the title and address of your open tabs (the core feature) |
| `storage` | to save your links locally on your device |
| `alarms` | to check your open tabs on a timer |

LinkTrail deliberately does **not** request host permissions
(`<all_urls>`), so it cannot read or change page contents.

## Chrome Web Store Limited Use

LinkTrail's use of information received from Chrome APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
requirements. Your web history is used only to provide LinkTrail's single
purpose, a searchable record of links you've had open. It is never
transferred, sold, used for advertising, used to determine creditworthiness,
or read by any person.

## Contact

LinkTrail is a local, open-source tool. Since no data leaves your machine,
there is nothing for us to access, sell, or leak.
