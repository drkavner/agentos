# TOOLS.md - Sage's Local Notes

## Twitter Multi-Account Setup

You have access to 3 Twitter accounts. Credentials are in `agent/twitter-accounts.json`.

### Accounts
| Account | Handle | Use For |
|---------|--------|---------|
| **quickclaw** | @GetQuickClaw | QuickClaw product tweets, launches, features |
| **cerebratech** | @CerebratechAI | Blog promotion, thought leadership, AI/education |
| **drkavner** | @DrKavner | Personal brand (use sparingly, with approval) |

### How to Post

**Default (@GetQuickClaw):**
```bash
bird tweet "your tweet"
```

**To @CerebratechAI:**
```bash
source <(jq -r '.cerebratech | to_entries | .[] | "export \(.key)=\(.value)"' agent/twitter-accounts.json)
bird tweet "your tweet"
```

**To @DrKavner:**
```bash
source <(jq -r '.drkavner | to_entries | .[] | "export \(.key)=\(.value)"' agent/twitter-accounts.json)
bird tweet "your tweet"
```

### Account Selection Rules
- **Blog posts about AI/education** → @CerebratechAI
- **QuickClaw content** → @GetQuickClaw  
- **Personal takes, opinions** → @DrKavner (get approval first)

---

## Twitter DM Access (Browser Profiles)

For DMs, use browser automation with dedicated profiles:

| Account | Browser Profile |
|---------|-----------------|
| @GetQuickClaw | `twitter-quickclaw` |
| @CerebratechAI | `twitter-cerebratech` |
| @DrKavner | `twitter-drkavner` |

### How to Send a DM

1. Open DMs in the right profile:
```
browser action=navigate profile=twitter-quickclaw targetUrl="https://x.com/messages/compose?recipient_id=USER_ID"
```

2. Take snapshot, find the message box, type and send.

### Finding User ID
Use `bird about USERNAME` to get their numeric ID.

---

Add your own notes below as needed.
