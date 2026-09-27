IELTS Vocab Lab — Vercel deployment package

Contents:
- index.html — the complete app

Recommended deployment path:
1. Put index.html in a GitHub repository.
2. Import the repository into Vercel.
3. Framework Preset: Other
4. Build Command: leave empty
5. Output Directory: leave empty
6. Deploy.
7. In Supabase Authentication > URL Configuration, set Site URL to the final Vercel production URL.

The Supabase publishable key is safe to use in browser code. Never add a service_role or secret key to this file.
