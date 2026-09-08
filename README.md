# SE Take-Home: The Meridian Engagement

## The engagement

You're the WorkOS Solutions Engineer on a live evaluation. Meridian Analytics, a multi-tenant B2B SaaS company, is choosing between WorkOS and two other auth vendors this quarter. After your kickoff call, their Head of Platform sent the requirements brief in [`SCENARIO.md`](./SCENARIO.md). Your job: configure WorkOS and extend this app into the proof-of-capability demo that wins the evaluation, then present it to them. This repo is a working Next.js app with AuthKit sign-in already wired up. Treat it as the starting point Meridian's team will judge.

## Setup

Create your own copy of this repository with the **Use this template** button (rather than forking).

You will need a [WorkOS account](https://dashboard.workos.com/signup); the free tier covers everything the scenario asks for.

1. In the [WorkOS dashboard](https://dashboard.workos.com), head to the Redirects tab and create a [sign-in callback redirect](https://workos.com/docs/user-management/nextjs) for `http://localhost:3000/callback` and set the app homepage URL to `http://localhost:3000`.

2. After creating the redirect URI, navigate to the API keys tab and copy the _Client ID_ and the _Secret Key_. Rename the `.env.local.example` file to `.env.local` and supply your Client ID and API key as environment variables.

3. Additionally, create a cookie password as the private key used to encrypt the session cookie. Copy the output into the environment variable `WORKOS_COOKIE_PASSWORD`.

   It has to be at least 32 characters long. You can use https://1password.com/password-generator/ to generate strong passwords.

4. Verify your `.env.local` file has the following variables filled.

   ```bash
   WORKOS_CLIENT_ID=<YOUR_CLIENT_ID>
   WORKOS_API_KEY=<YOUR_API_SECRET_KEY>
   WORKOS_COOKIE_PASSWORD=<YOUR_COOKIE_PASSWORD>

   NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
   ```

5. Run the following command and navigate to [http://localhost:3000](http://localhost:3000).

   ```bash
   npm run dev
   ```

One scenario note: the customer's SSO requirement names their Okta. You are expected to create a free-trial Okta developer account and set up a live Okta SSO connection. [Create a free Okta Developer account using this link](https://www.okta.com/free-trial).

## Required tooling

Before you start building, install the WorkOS agent skills in your repo:

```bash
npx skills add workos/skills
```

This adds the [WorkOS skills](https://github.com/workos/skills) (including `workos-widgets`) to your repo so your AI tooling has current integration guides to work from. See the [widget skills announcement](https://workos.com/blog/widget-skills) for background.

On AI use: we expect you to use AI tools throughout. That's not a loophole; it's the job. What we evaluate is the judgment you exercised, not whether you typed every line. You'll document how you worked with AI in `SUBMISSION.md`.

## What to build

Satisfy the brief. `SCENARIO.md` is the spec: there is no screen count or component checklist hiding here. Read it the way you'd read a real customer email. Decide what they actually need, notice what's underspecified, and make the calls a good SE would make. Anything the customer asked for should work; anything you add beyond that should earn its place.

The customer's "down the road" wish-list item is optional bonus territory. If you take it on, [WorkOS Pipes](https://workos.com/docs/pipes) is the intended tool.

## Time and deadline

Plan for 4–6 focused hours. You have one week from receiving this assignment.

## Deliverables

1. **Deployed app**: a working URL (Vercel is the expected host).
2. **Your repo**: a link to your copy for code review. If you make it private, coordinate reviewer access through your recruiting contact.
3. **Test credentials**: one working login per scenario role inside the demo tenant organization, listed in `SUBMISSION.md`. Provide email/password credentials for a user that the reviewer may use in order to access the application as well as the WorkOS workspace.
4. **Demo video**: 5–10 minutes, presented as if Meridian's team is watching. Show the app doing what the brief asks, and include a tour of your WorkOS dashboard explaining how you configured it. If recording isn't workable for you, a written walkthrough with screenshots is an accepted (second-best) alternative.
5. **Completed `SUBMISSION.md`**: filled in and committed to your repo.

## How we evaluate

The scored rubric stays on our side, but it weighs:

- Requirement coverage, and how you interpreted the parts that needed interpreting
- Correct WorkOS dashboard configuration, verified through your video and test logins
- Product and UX quality: the demo should feel like software, not a checklist
- The quality of your AI collaboration, as evidenced in your decision log
- Communication: does the video actually sell this to a skeptical customer?

## License

MIT. This repository is a WorkOS interview exercise; it isn't seeking outside contributions, but you're welcome to do whatever you like with your own copy.
