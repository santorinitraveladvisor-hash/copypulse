@AGENTS.md

## Deploy Configuration (configured by /setup-deploy)
- Platform: Vercel (dashboard) + Railway (bot engine)
- Production URL: https://copypulse.vercel.app
- Deploy workflow: auto-deploy on push to main (Vercel); `railway up --detach` (Railway bot)
- Deploy status command: `vercel ls --prod` / Railway dashboard
- Merge method: squash
- Project type: web app (Next.js dashboard) + Node.js bot (Railway)
- Post-deploy health check: https://copypulse.vercel.app/api/account-status

### Custom deploy hooks
- Pre-merge: none
- Deploy trigger (Vercel): automatic on push to main
- Deploy trigger (Railway): `railway up --detach`
- Deploy status (Vercel): `vercel ls --prod`
- Health check: https://copypulse.vercel.app/api/account-status
