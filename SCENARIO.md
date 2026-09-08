# The Customer Brief

The email below arrived after your kickoff call with Meridian Analytics. It is the requirements brief for this engagement. Read it the way you'd read a real customer email. Logistics (what you build on, what you deliver, and when) live in the README; this email is the source of truth for what the customer needs.

---

**From:** Priya Shah \<priya.shah@meridiananalytics.com\>
**To:** WorkOS Solutions Engineering
**Subject:** Re: Kickoff call - what we need to see before we commit

Hi,

Thanks for the call on Tuesday. I'll be straight with you about where we are: we're evaluating WorkOS against two other vendors and want to make a decision this quarter. The team liked what they heard, but liking a pitch and betting our auth on it are two different things. Before we commit, we need to see this working.

Some background for whoever builds the demo. Meridian sells analytics dashboards to mid-market and enterprise companies. Our customers are companies, not individuals. Each one needs its own walled-off space: their people, their rules, no bleed-over between them. Our homegrown auth was never built for that. Today, when a customer wants to add a user, they email our support team and someone does it by hand. A couple of our earliest customers still share one login across their whole team. All of that has to end before we move upmarket. (Migrating off the old system is our problem, not yours; we just need to see where we'd land.)

Here's what we need the demo to prove, using Acme Corp as the example customer (they're our design partner and have agreed to be the guinea pig):

1. Each customer is its own workspace: their people, their rules, zero visibility into anyone else's. If someone at Acme can see another customer's members, we're done.

2. Acme's admins can invite people, remove them, and change their access, for their own workspace, without opening a ticket with us. Fully self-serve, inside our app.

3. Within a customer like Acme there are three kinds of users: admins, who run the workspace; team leads, who look after their own people; and their compliance folks, who need to see everything going on in the workspace but must not be able to change anything. What you name these and how you present them in the product is your call; you know your platform better than we do.

4. Acme won't roll this out unless their employees sign in through their own Okta. Their IT director was blunt: no Okta, no deal. That makes it a dealbreaker for us too. Acme is the reference customer for this whole segment.

5. Separate item: our biggest prospect (can't name them yet) has a security team with two hard rules. Sessions expire 24 hours after sign-in, no exceptions, and admins have to sign in with MFA. We need to know we can enforce that kind of policy for one customer without changing anything for the rest. Configure it in the demo so we can see it working, not a link to a doc saying it's possible.

One more thing, from our engineers: the simplest option on our side would be calling the WorkOS API directly from our frontend with the API key, one less backend piece to build and maintain. Can the demo just do that? If there's a reason not to, we'd want to hear it.

Down the road (not needed for this evaluation), it would be great if our #customer-success Slack channel got pinged whenever a customer adds or removes someone. Our CS team lives and dies by seat changes. If it's quick to show, great; if not, don't spend your time there.

For the review, my team will click through whatever you deploy and watch whatever walkthrough you send over. Assume they're skeptical engineers who've been burned by vendor demos before.

Looking forward to seeing it.

Priya

--
Priya Shah
Head of Platform, Meridian Analytics
