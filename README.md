# What To Do

**From an idea to a scoped, scaffolded, running project in one prompt.**

[![Live](https://img.shields.io/badge/Live_Demo-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://whattodoby.filheinzrelatorre.com)

![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

<br>

<p align="center"><img src="docs/demo.gif" alt="What To Do demo" width="800"></p>

Describe an app idea in a sentence and What To Do turns it into a full PRD, a recommended tech stack with reasoned alternatives, and a downloadable boilerplate project scaffolded to match, with a live in-browser preview before you ever download a single file.

## Try it

**Live:** [whattodoby.filheinzrelatorre.com](https://whattodoby.filheinzrelatorre.com) - no account needed to generate a PRD and preview a boilerplate; sign in to save projects.

## How it works

1. **Idea to PRD** - a short prompt is expanded into a structured product-requirements document (problem, scope, sections, edge cases) via Groq.
2. **PRD to stack recommendation** - the PRD is matched against a stack matrix (framework, database, auth, hosting) with a primary pick plus alternatives and the reasoning behind each.
3. **Stack to boilerplate** - a real, runnable project is generated from a registry of templates (currently Next.js + Postgres + Drizzle, FastAPI + Postgres) and zipped for download.
4. **Live verification** - the generated project boots in-browser via WebContainer before download, so what you get is a project that's already been proven to run, not just a set of files that should.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Auth | NextAuth (Auth.js) with Drizzle adapter |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| LLM | Groq |
| In-browser runtime | WebContainer API (live boilerplate preview) |
| Object storage | Cloudflare R2 (S3-compatible, AWS SDK client) |
| Jobs / caching | Upstash QStash + Redis |
| Validation | Zod |
| Styling | Tailwind CSS v4 |

## Local setup

```bash
pnpm install
cp .env.example .env       # fill in the values
pnpm db:generate            # generate Drizzle migrations
pnpm db:migrate              # apply migrations
pnpm dev                     # http://localhost:3000
```

## Scripts

```bash
pnpm dev             # dev server
pnpm build            # production build
pnpm start             # serve the production build locally
pnpm lint               # eslint
pnpm db:generate         # generate a Drizzle migration from schema
pnpm db:migrate           # apply migrations
pnpm r2:lifecycle          # configure R2 bucket lifecycle rules
```

## Deployment

Deployed on Vercel, connected to this repository. Push to `master` to deploy.

---

## About the developer

**Fil Heinz O. Re La Torre** - Automation & AI Solutions Engineer, building integrations and AI-backed workflows that go from idea to production in days.

[![Portfolio](https://img.shields.io/badge/Portfolio-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://www.filheinzrelatorre.com)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://ph.linkedin.com/in/filheinzrelatorre)
[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/jabluetooth)
[![Gmail](https://img.shields.io/badge/Gmail-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:filheinz27@gmail.com)

**Other projects:** [Match](https://github.com/jabluetooth/match) · [ZeroPress](https://github.com/jabluetooth/zeropress) · [Mimo](https://github.com/jabluetooth/mimo) · [Insight](https://github.com/jabluetooth/insight) · [see all →](https://github.com/jabluetooth)
