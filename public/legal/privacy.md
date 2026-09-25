# Privacy Policy

## Overview

Nocturne is a web platform. We are committed to being transparent about what data we do and do not collect. This policy explains our practices clearly.

## Data We Do Not Collect

We do not collect, log, store, or sell:

- Your browsing history or the sites you visit through the service.
- The content of the pages you load through the service.
- Passwords or form data you submit through the service.
- Your IP address in connection with your browsing. The sites you visit through the service are never tied to your IP in any log we keep.

**Exceptions, stated plainly:** certain non-browsing actions **do** record your IP address and a device fingerprint:

- **Account activity** — when you sign up, log in, or use the platform during an active session, your IP address, browser fingerprint, and user agent are recorded in a user activity log. This is used for abuse prevention, ban enforcement, and identifying users who create multiple accounts to evade bans.
- **AI assistant use** (both the in-app chat and the public `/api/ai`) and **opening or closing a VM desktop** — these record your IP address and a device fingerprint in an internal operations log.

This is separate from your browsing. See [Operational Logging](#operational-logging) below for exactly what is recorded and why.

## How It Works

Traffic routed through Nocturne passes through our servers solely to facilitate access. We do not inspect, log, or retain the content of your requests, and routed traffic is not associated with any account or identifier.

## Analytics

Nocturne uses **Google Analytics** on its own pages (home, apps, settings, and similar) to understand basic, anonymous usage such as page views, country-level location, and browser or device type. It does **not** track what you browse through the service. You can opt out with any tracker blocker (such as uBlock Origin) or your browser's tracking protection.

## Advertising

Nocturne is free, and advertising is what pays for it. We work with a third-party advertising network, **EffectiveCPMNetwork**, which serves what is commonly called a "pop-under" ad: after you click anywhere on a Nocturne page, a new browser tab opens in the background with an advertiser's page in it.

A few things worth being straightforward about:

- **Ads cannot be switched off.** Under Settings → Performance you can choose how often they are allowed to appear — anywhere from once every minute to once every 10 minutes — but there is no option to disable them entirely. The default is once every 2 minutes.
- **An ad is a real visit to someone else's site.** When a pop-under opens, your browser connects directly to the advertising network and to whatever page it sends you to. Those parties can see your IP address, user agent, screen size, referring page, and anything else a website normally sees about a visitor, and they may set their own cookies or use their own trackers. This happens between your browser and them — it does not pass through our servers, and we neither receive nor store any of it.
- **Our no-logging policy does not extend to them.** The commitments elsewhere in this policy describe what *Nocturne* does. Once an ad opens, you are on a third party's site and their privacy policy governs, not ours. We do not control, endorse, or vet the advertisers shown.
- **The AI page is excluded**, so no pop-unders open while you are using the AI assistant.
- A standard content or ad blocker will stop pop-unders, as will your browser's built-in pop-up blocker.

The only thing stored locally for this is your chosen frequency and a timestamp of the last ad shown, so the cooldown can be enforced (see Stored In Your Browser).

## Optional Accounts

Accounts are optional and need no email — just a username and password. If you create one, the server stores your username, a scrypt-hashed password (never the plaintext), session tokens, your saved AI chats, your saved Code editor projects, and your per-account cookie storage. You can delete your account at any time from the Account page, which removes all of that data immediately.

## Captcha & Bot Protection

Creating an account or signing in requires solving a [Cap](https://trycap.dev) challenge — a self-hosted, privacy-first proof-of-work puzzle that your browser solves automatically in the background. It is **not** a third-party captcha service like reCAPTCHA or hCaptcha: the challenge is generated and verified entirely by our own server, involves no tracking, fingerprinting, or image/audio puzzles, and nothing about you or your device is sent anywhere outside Nocturne to complete it. We also keep a short-lived, in-memory counter per IP address (a handful of signup/login attempts every few seconds) purely to blunt automated spam; like all abuse-prevention counters on this site, it is never written to a database or log we control.

## Children's Privacy

Nocturne is not intended for use by children under 13 without the consent of a parent or guardian. By using Nocturne, you represent that you are at least 13, or that you have appropriate parental or guardian consent. Because of our no-logging policy, we have no way to verify any user's age and rely on this representation.

We do **not** knowingly collect personal information from children under 13. **If we become aware that we hold information belonging to a child under 13 without verified parental consent, we will delete it.** This applies however we find out — whether we notice it ourselves, a parent or guardian reports it, or someone else brings it to our attention. On learning of it we will remove the account and everything tied to it: saved AI conversations, community-chat and direct messages, saved Code projects, per-account cookie storage, session records, and usage totals. We act on good-faith reports; we will not require a parent to prove the relationship or supply further personal information about the child before we delete, since demanding more data to honour a deletion request defeats the point.

To make a request, email [hello@midtsy.xyz](mailto:hello@midtsy.xyz) with any detail that identifies the account — a username is enough. There is no charge and no account needed. A parent or the account holder can also delete everything immediately and without contacting us at all, from the Account page.

## Stored In Your Browser

Most of what Nocturne remembers lives in **your browser** (localStorage) and is never sent to us: your search engine, tab cloak, theme and performance settings, your chosen ad frequency together with the time the last ad was shown (used only to enforce the cooldown between ads), and whatever you're currently working on in the Code page's editor. Your AI chats are kept here too; when you are signed in they also sync to your account (see AI Features). All of it is cleared when you clear this site's storage.

## Code Projects & Sharing

The Code page lets you write and run code entirely in your browser without an account. If you sign in, you can additionally save a project to the server ("Projects") so it's available on any device — this stores the project's files and name, and counts toward a per-account storage limit. You can rename, overwrite, or delete a saved project at any time from the Projects panel; deleting removes it from the server immediately.

Using **Share** on a project you've saved while signed in generates a link in the form `nocturne.lol/s/<username>/<n>`. That link is **public**: anyone who has it can open a read-only copy of that project's files without needing an account or signing in — access is by knowledge of the link, not by any additional permission check. Don't share a project containing secrets, credentials, or anything you don't want a stranger with the link to see. If you use Share while signed **out**, nothing is stored on our server at all — the entire project is encoded directly into the link itself, so it only works if you send that exact link to someone.

## AI Features

When you use the AI assistant, the messages you send are forwarded to the AI provider to generate a reply. Messages may be screened by an automated safety filter before sending. If you are **not** signed in, your chat history stays only in your browser. If you **are** signed in, your conversations — the messages you send and the replies you receive — are also saved to your account on our server so you can pick them back up on any device, together with a short title that is generated automatically to summarize each chat. You can delete an individual chat or your entire account at any time, which removes that data from the server.

To keep the AI free and fair for everyone, we also record an aggregate count of how many tokens your account uses and an estimated cost figure, so we can apply daily usage limits and show you your own usage. These are running totals tied to your account — never the content of your messages — and they are deleted when you delete your account. We do **not** log IP addresses against the **content** of your chat messages, moderation events, or your login sessions. We **do** record your IP address and a device fingerprint against the *fact* that an AI request happened (model, timing, token count — not the message text), as described under [Operational Logging](#operational-logging).

## Operational Logging

**Strictly for security purposes** — detecting and preventing abuse, fraud, ban evasion, and attacks — internal logs record certain **actions** (never message or page content) accessible only to the operators. They are used for nothing else. They capture:

- **When you sign up, log in, or visit the platform**: your username, IP address, browser fingerprint, and user agent string. This is stored in a persistent database and used to enforce bans, identify ban-evading accounts, and link accounts that share an IP or device.
- **When you use the AI assistant** (in-app chat and the public `/api/ai`): your username if signed in, your IP address, a device fingerprint, the model, response time, and token count — but **not** the text of your prompts or the replies.
- **When you open or close a VM desktop**: your username, IP address, and a device fingerprint.

**The device fingerprint** is a short code your browser computes from coarse signals — screen size, timezone, language, GPU/canvas rendering, and similar — and stores in a first-party cookie (`noct_fp`). It is a *fuzzy* identifier used to spot one person cycling accounts to evade limits or bans; it is **not** a hardware serial, it can be shared by similar devices, and it resets if you clear this site's storage. Clearing your browser storage removes it; a tracker/fingerprint blocker will prevent it from being computed at all.

This log exists **only for security** — it is never sold or shared, never used to build advertising or marketing profiles, and never used to track what you browse. It is retained only as long as needed for that security purpose. Proxied browsing is **never** part of this log.

## Third-Party Services

Nocturne uses the following third-party services, which may have their own privacy practices:

- Google Fonts — loaded for typography (the Inter font).
- jsDelivr CDN — loaded for scripts and assets.
- Google Analytics — basic, anonymous usage statistics on our own pages.
- EffectiveCPMNetwork — the advertising network that supplies the pop-under ads described under Advertising. It receives your IP address and browser details directly when an ad opens, and operates under its own privacy policy.
- TMDB — used to display movie and show information on the Movies page.
- Search suggestions — as you type in the search bar, your query is sent through our server to a search engine to fetch suggestions. It is not stored.

## Cookies

Nocturne does not use cookies for cross-site tracking or advertising. A single session cookie is set only if you sign in to an account, and a short-lived verification cookie may be set by the automated browser check that runs before the site loads. A first-party device-fingerprint cookie (`noct_fp`) is set for the abuse-prevention log described under [Operational Logging](#operational-logging); it stays on this site and is never sent to a third party. Any cookies set during a browsing session belong to the destination site and are handled within the session context. Separately, the advertising network and the advertisers it sends you to may set their own cookies in the tab a pop-under opens; those are theirs, not ours, and we cannot read them (see Advertising).

## Changes To This Policy

We may update this privacy policy occasionally. Changes will be reflected by updating the date at the bottom of this page.

## Contact

Questions about this policy can be directed to us via email at [hello@midtsy.xyz](mailto:hello@midtsy.xyz).

Last updated: 2026-09-19
