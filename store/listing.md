# Chrome Web Store listing: copy and paste

Everything the developer dashboard asks for, in the order it asks. Images are in
this folder.

---

## Package tab

Upload `linktrail-chrome.zip` (built and zipped as in PUBLISHING.md, steps 0–1).

## Store listing tab

**Description** (the summary line comes from `manifest.json` automatically:
*"Find any link you've had open. Private by design: everything stays on your device."*)

```
Closed a tab and can't find it again? LinkTrail keeps a private, searchable history of every page you've had open, so you can find it and reopen it in seconds.

HOW IT WORKS
• LinkTrail checks your open tabs every few minutes and shortly after you open a page, and saves each page's address and title.
• Click the toolbar icon, type a few letters of the title or address, and click a result to reopen it.
• Export everything as JSON whenever you like.

PRIVATE BY DESIGN
• Everything stays on your device. LinkTrail has no servers, no accounts, no analytics, and makes no network requests.
• Query strings and fragments (the parts of an address that often hold login tokens or personal data) are removed before anything is saved.
• Private and incognito windows are never recorded.
• It can't read what's on your pages. It sees only each tab's address and title.

YOU'RE IN CONTROL
• Pause recording with one click.
• List sites that should never be recorded. Links already saved from them are deleted.
• Turn off page titles if you'd rather not keep them.
• Delete everything permanently at any time.

Open source (MIT): https://github.com/irfan-farmer/linktrail
```

**Category:** Productivity → Tools (or the closest Productivity option shown)
**Language:** English

**Graphic assets**

| Field | File |
|---|---|
| Store icon (128×128) | taken from the package (`icons/icon-128.png`) |
| Screenshots (1280×800) | `screenshot-1-history.jpg`, `screenshot-2-search.jpg`, `screenshot-3-privacy.jpg` |
| Small promo tile (440×280) | `promo-small-440x280.jpg` |
| Marquee promo tile | optional, skip |

**Additional fields**

- Official URL: leave as none (needs a verified domain)
- Homepage URL: `https://github.com/irfan-farmer/linktrail`
- Support URL: `https://github.com/irfan-farmer/linktrail/issues`

## Privacy practices tab

**Single purpose**

```
LinkTrail keeps a private, searchable history of the web pages the user has had open, stored only on the user's device, so the user can find and reopen them later.
```

**Permission justifications**

`tabs`
```
Required to read the address and title of the user's open tabs. That is the only data LinkTrail uses, and it builds the user's local, searchable link history from it. Page contents are never accessed.
```

`storage`
```
Stores the user's link history and settings in chrome.storage.local on the user's device. Nothing is transmitted anywhere.
```

`alarms`
```
Schedules the periodic check of open tabs (every 5 minutes by default, user-adjustable) that keeps the history up to date.
```

**Remote code:** No, I am not using remote code.

**Data usage**, first group (what the extension handles):

- [x] **Web history**: addresses (query strings removed by default), page titles, and when each was first and last seen, stored locally only.
- [ ] Everything else (personally identifiable info, health, financial, authentication, personal communications, location, user activity, website content): leave unchecked.

**Data usage**, second group: check all three certifications.

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/irfan-farmer/linktrail/blob/main/PRIVACY.md
```

## Distribution tab

- Payments: free
- Visibility: Public (or **Unlisted** first, if you want to try the store install before anyone can find it)
- Regions: all regions

## Account (one-time)

- **Contact email is shown publicly on the listing.** Use a dedicated address, not
  a personal or work one.
- **Trader / non-trader** declaration (EU Digital Services Act): this is your own
  legal call. Non-traders are labelled as such on the listing. Traders must
  verify and publish an address and phone number.
